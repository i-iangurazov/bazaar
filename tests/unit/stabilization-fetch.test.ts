import { describe, expect, it, vi } from "vitest";
import { createStabilizationFetch, stabilizationEmailKey } from "../../scripts/stabilization/fetch";

const payload = { to: ["synthetic@example.invalid"], subject: "Verify", text: "local token", html: "<p>local token</p>" };
const options = () => ({ method: "POST", headers: { Authorization: `Bearer ${stabilizationEmailKey}` }, body: JSON.stringify(payload) });

describe("isolated browser-server email boundary", () => {
  it("captures the real outbound message without forwarding it to a provider", async () => {
    const originalFetch = vi.fn<typeof fetch>();
    const captureEmail = vi.fn().mockResolvedValue("local_capture");
    const fetch = createStabilizationFetch({ originalFetch, captureEmail });
    expect(await (await fetch("https://api.resend.com/emails", options())).json()).toEqual({ id: "local_capture" });
    expect(captureEmail).toHaveBeenCalledWith(payload);
    expect(originalFetch).not.toHaveBeenCalled();
  });

  it("rejects real credentials, real recipients, and all other external destinations", async () => {
    const originalFetch = vi.fn<typeof fetch>();
    const captureEmail = vi.fn();
    const fetch = createStabilizationFetch({ originalFetch, captureEmail });
    await expect(fetch("https://api.resend.com/emails", { ...options(), headers: { Authorization: "Bearer real-key" } })).rejects.toThrow("synthetic provider credential");
    await expect(fetch("https://api.resend.com/emails", { ...options(), body: JSON.stringify({ ...payload, to: ["person@real-business.com"] }) })).rejects.toThrow("synthetic recipients");
    await expect(fetch("https://api.resend.com/domains", options())).rejects.toThrow("External fetch disabled");
    await expect(fetch("https://localhost.example.com/", {})).rejects.toThrow("External fetch disabled");
    expect(captureEmail).not.toHaveBeenCalled();
    expect(originalFetch).not.toHaveBeenCalled();
  });

  it("propagates capture failure so a missing local email is not reported as sent", async () => {
    const fetch = createStabilizationFetch({ originalFetch: vi.fn(), captureEmail: vi.fn().mockRejectedValue(new Error("disk unavailable")) });
    await expect(fetch("https://api.resend.com/emails", options())).rejects.toThrow("disk unavailable");
  });

  it("forwards local requests while refusing redirects out of the boundary", async () => {
    const originalFetch = vi.fn().mockResolvedValue(new Response("local"));
    const fetch = createStabilizationFetch({ originalFetch, captureEmail: vi.fn() });
    await fetch("http://localhost:3108/api/auth/session", { redirect: "follow" });
    expect(originalFetch).toHaveBeenCalledWith("http://localhost:3108/api/auth/session", { redirect: "error" });
  });
});
