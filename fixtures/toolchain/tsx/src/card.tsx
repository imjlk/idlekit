function h(tag: string, props: unknown, ...children: unknown[]) {
  return { tag, props, children };
}

declare global {
  namespace JSX {
    interface IntrinsicElements { text: { children?: string }; }
  }
}

export function Card(props: { label: string }) {
  return <text>{props.label}</text>;
}
