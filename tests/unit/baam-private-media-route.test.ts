import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  context: vi.fn(), own: vi.fn(), find: vi.fn(), active: vi.fn(), save: vi.fn(), consent: vi.fn(),
  prepare: vi.fn(), publish: vi.fn(),
}));
vi.mock("@/server/trpc/trpc", () => ({ createContext: m.context }));
vi.mock("@/server/services/baamConversations", () => ({ ownBaamConversation: m.own }));
vi.mock("@/server/services/baamAudio", () => ({ transcribeBaamAudio: vi.fn() }));
vi.mock("@/server/services/aiPrivacy", () => ({ assertAiConsent: m.consent }));
vi.mock("@/server/services/productImageSourceUpload", () => ({ prepareProductStudioSource: m.prepare }));
vi.mock("@/server/services/productImageStorage", () => ({ downloadRemoteImage: vi.fn(), uploadProductImageBuffer: m.publish }));
vi.mock("@/server/middleware/rateLimiter", () => ({ createRateLimiter: () => ({ consume: vi.fn() }) }));
vi.mock("@/server/db/prisma", () => {
  const tx = { $queryRaw: vi.fn(), baamConversation: { findFirst: m.active }, baamAttachment: { upsert: m.save } };
  return { prisma: { baamAttachment: { findUnique: m.find }, $transaction: (run: (tx: unknown) => unknown) => run(tx) } };
});

import { GET, POST } from "@/app/api/baam/media/route";
import { AppError } from "@/server/services/errors";
import { decryptBaamMedia, encryptBaamMedia } from "@/server/services/baamPrivateMedia";

const bytes = Buffer.from("synthetic normalized png bytes");
const scope = { organizationId: "synthetic-org", conversationId: "synthetic-conversation", mimeType: "image/png" };
const request = () => {
  const form = new FormData();
  form.set("conversationId", scope.conversationId); form.set("locale", "en"); form.set("kind", "image");
  form.set("file", new File([new Uint8Array(bytes)], "private.png", { type: "image/png" }));
  return new Request("http://localhost/api/baam/media", { method: "POST", body: form });
};

describe("private BAAM upload and authenticated serving", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BAAM_MEDIA_ENCRYPTION_KEY", Buffer.alloc(32, 6).toString("base64"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    m.context.mockResolvedValue({ user: { id: "synthetic-user", organizationId: scope.organizationId }, impersonator: null });
    m.own.mockResolvedValue({ scope: { organizationId: scope.organizationId } });
    m.find.mockResolvedValue(null); m.active.mockResolvedValue({ id: scope.conversationId });
    m.save.mockImplementation(async ({ create }: { create: object }) => ({ id: "synthetic-attachment", ...create }));
    m.consent.mockResolvedValue(undefined);
    m.prepare.mockResolvedValue({ buffer: bytes, contentType: "image/png" });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("stores encrypted bytes transactionally and returns only an authenticated URL, never a public upload or envelope", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const dto = await response.json();
    expect(dto).toEqual({ id: "synthetic-attachment", name: "private.png", mimeType: "image/png", url: "/api/baam/media?attachmentId=synthetic-attachment" });
    const stored = m.save.mock.calls[0][0].create;
    expect(stored.url.startsWith("baam-private:v1:")).toBe(true);
    expect(decryptBaamMedia(stored.url, scope)).toEqual(bytes);
    expect(m.publish).not.toHaveBeenCalled();
    expect(JSON.stringify(dto)).not.toContain("baam-private");
  });

  it("fails closed before storing with missing configuration, revoked consent or an account deleted during upload", async () => {
    vi.stubEnv("BAAM_MEDIA_ENCRYPTION_KEY", "");
    expect((await POST(request())).status).toBe(409);
    expect(m.save).not.toHaveBeenCalled();
    vi.stubEnv("BAAM_MEDIA_ENCRYPTION_KEY", Buffer.alloc(32, 6).toString("base64"));
    m.consent.mockRejectedValueOnce(new AppError("aiConsentRequired", "FORBIDDEN", 403));
    expect((await POST(request())).status).toBe(403);
    expect(m.save).not.toHaveBeenCalled();
    m.active.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(404);
    expect(m.save).not.toHaveBeenCalled();
    expect(m.publish).not.toHaveBeenCalled();
  });

  it("decrypts only after conversation authorization and sends no-store image bytes without redirecting", async () => {
    m.find.mockResolvedValue({ id: "synthetic-attachment", conversationId: scope.conversationId,
      mimeType: scope.mimeType, url: encryptBaamMedia(bytes, scope) });
    const url = new Request("http://localhost/api/baam/media?attachmentId=synthetic-attachment");
    const response = await GET(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("location")).toBeNull();
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(m.own).toHaveBeenCalledWith(expect.anything(), scope.conversationId);
    m.own.mockRejectedValueOnce(new AppError("unauthorized", "UNAUTHORIZED", 401));
    expect((await GET(url)).status).toBe(401);
    m.own.mockRejectedValueOnce(new AppError("baamConversationNotFound", "NOT_FOUND", 404));
    expect((await GET(url)).status).toBe(404);
  });
});
