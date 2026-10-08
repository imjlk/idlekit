import { createContext, createElement, useContext, type ReactNode } from "react";

export type ResolvedTuiImageOptions = Readonly<{
  mode: "auto" | "on" | "off";
  protocol: "auto" | "kitty" | "iterm2" | "sixel";
  width?: number; height?: number;
}>;

const RuntimeContext = createContext({ exit() {} });

export function RuntimeProvider(props: { onExit: () => void; children?: ReactNode }) {
  return createElement(RuntimeContext.Provider, { value: { exit: props.onExit } }, props.children);
}

export function useRuntime() { return useContext(RuntimeContext); }

export async function runTui(element: ReactNode): Promise<void> {
  const { createCliRenderer } = await import("@opentui/core");
  const { createRoot } = await import("@opentui/react");
  const renderer = await createCliRenderer({ exitOnCtrlC: false, screenMode: "alternate-screen" });
  const root = createRoot(renderer);
  await new Promise<void>((resolve, reject) => {
    let closed = false;
    const exit = () => {
      if (closed) return;
      closed = true;
      root.unmount();
      renderer.destroy();
      resolve();
    };
    try { root.render(createElement(RuntimeProvider, { onExit: exit }, element)); }
    catch (error) { exit(); reject(error); }
  });
}

export function detectImageCapability(args: { env?: NodeJS.ProcessEnv; stdout?: Pick<NodeJS.WriteStream, "isTTY"> } = {}) {
  const env = args.env ?? process.env;
  if (!(args.stdout ?? process.stdout).isTTY) return { supported: false, reason: "non-tty", protocol: undefined };
  if (env.KITTY_WINDOW_ID || env.TERM?.includes("kitty") || env.TERM_PROGRAM === "WezTerm") {
    return { supported: true, protocol: "kitty" as const, reason: undefined };
  }
  if (env.TERM_PROGRAM === "iTerm.app") return { supported: true, protocol: "iterm2" as const, reason: undefined };
  return { supported: false, reason: "unsupported-terminal", protocol: undefined };
}

export async function renderImage(source: { kind: "bytes"; bytes: Uint8Array; mimeType: string }, options: ResolvedTuiImageOptions) {
  if (options.mode === "off") return { rendered: false, reason: "disabled" };
  const capability = detectImageCapability();
  const protocol = options.protocol === "auto" ? capability.protocol : options.protocol;
  if (!capability.supported || (protocol !== "kitty" && protocol !== "iterm2")) {
    return { rendered: false, reason: capability.reason ?? "unsupported-protocol" };
  }
  const data = Buffer.from(source.bytes).toString("base64");
  if (protocol === "iterm2") {
    process.stdout.write(`\x1b]1337;File=inline=1;size=${source.bytes.length};width=${options.width ?? "auto"};height=${options.height ?? "auto"}:${data}\x07`);
  } else {
    for (let offset = 0; offset < data.length; offset += 4096) {
      const more = offset + 4096 < data.length ? 1 : 0;
      const header = offset === 0 ? `a=T,f=100,c=${options.width ?? 70},r=${options.height ?? 18},m=${more}` : `m=${more}`;
      process.stdout.write(`\x1b_G${header};${data.slice(offset, offset + 4096)}\x1b\\`);
    }
  }
  return { rendered: true, reason: undefined };
}
