/** Browsers on a local HTTP address may not expose crypto.randomUUID.
 * Request IDs are tracing metadata; the server creates one when omitted.
 */
export const clientRequestHeaders = (): Record<string, string> =>
  typeof globalThis.crypto?.randomUUID === "function"
    ? { "x-request-id": globalThis.crypto.randomUUID() }
    : {};
