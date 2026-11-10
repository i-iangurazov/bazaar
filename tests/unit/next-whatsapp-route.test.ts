import { beforeEach, describe, expect, it, vi } from "vitest";

const webhook = vi.hoisted(() => vi.fn());
vi.mock("@/server/whatsapp/webhook", () => ({ receiveWhatsAppWebhook: webhook }));

import { GET, POST } from "@/app/api/integrations/whatsapp/[connectionId]/route";

beforeEach(() => vi.clearAllMocks());

describe("WhatsApp Next 15 route context", () => {
  it("awaits a promised connection before dispatching the original request", async () => {
    let resolveParams!: (value: { connectionId: string }) => void;
    const params = new Promise<{ connectionId: string }>((resolve) => { resolveParams = resolve; });
    const request = new Request("http://localhost/api/integrations/whatsapp/synthetic-connection", {
      method: "POST",
      body: "synthetic provider event",
    });
    const delivered = new Response("accepted", { status: 202 });
    webhook.mockResolvedValue(delivered);
    const result = POST(request, { params });
    expect(webhook).not.toHaveBeenCalled();
    resolveParams({ connectionId: "synthetic-connection" });
    expect(await result).toBe(delivered);
    expect(webhook).toHaveBeenCalledExactlyOnceWith(request, "synthetic-connection");
  });

  it("preserves retryable unavailable responses when the webhook service fails", async () => {
    webhook.mockRejectedValue(new Error("synthetic temporary failure"));
    const result = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ connectionId: "synthetic-connection" }),
    });
    expect(result.status).toBe(503);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.text()).toBe("unavailable");
  });

  it("retains a generic reachability response without resolving or disclosing a connection", async () => {
    const result = await GET();
    expect(result.status).toBe(200);
    expect(await result.text()).toBe("ok");
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(webhook).not.toHaveBeenCalled();
  });
});
