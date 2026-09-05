export const stabilizationEmailKey = "stabilization-local-capture-only";

export type CapturedEmail = {
  to: string[];
  subject: string;
  text: string;
  html: string;
  tags?: Array<{ name: string; value: string }>;
};

// Used only by the custom local launcher. The production email service remains
// unchanged; its actual provider request is captured at this network boundary.
export function createStabilizationFetch(input: {
  originalFetch: typeof globalThis.fetch;
  captureEmail: (email: CapturedEmail) => Promise<string>;
}): typeof globalThis.fetch {
  return async (resource, init) => {
    const url = new URL(
      typeof resource === "string" || resource instanceof URL ? resource : resource.url,
    );
    if (url.href === "https://api.resend.com/emails") {
      const request = new Request(resource, init);
      if (
        request.method !== "POST" ||
        request.headers.get("authorization") !== `Bearer ${stabilizationEmailKey}`
      ) throw new Error("Local email capture requires its synthetic provider credential.");
      const email = await request.json() as CapturedEmail;
      if (
        !Array.isArray(email.to) || !email.to.length ||
        !email.to.every((to) => typeof to === "string" && /@[^@\s]+\.(invalid|test)$/.test(to)) ||
        typeof email.subject !== "string" || typeof email.text !== "string" ||
        typeof email.html !== "string"
      ) throw new Error("Local email capture accepts synthetic recipients and complete payloads only.");
      const id = await input.captureEmail(email);
      return new Response(JSON.stringify({ id }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if (!(["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1"].includes(url.hostname))) {
      throw new Error("External fetch disabled in the isolated stabilization server.");
    }
    return input.originalFetch(resource, { ...init, redirect: "error" });
  };
}
