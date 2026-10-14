/** Only plugin security admission failures carry this marker. */
export class PluginTrustError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginTrustError";
  }
}

export function asPluginTrustError(error: unknown): PluginTrustError {
  let message = "Plugin security policy refused";
  try {
    if (error instanceof PluginTrustError) return error;
    if (error instanceof Error && typeof error.message === "string" && error.message.length > 0) message = error.message;
  } catch { /* A reflected error cannot escape the admission boundary. */ }
  return new PluginTrustError(message);
}
