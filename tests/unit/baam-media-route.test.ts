import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { AppError } from "@/server/services/errors";
import { AI_PRIVACY_CONSENT_VERSION } from "@/lib/aiPrivacy";
const mocks = vi.hoisted(() => ({
  own: vi.fn(),
  upload: vi.fn(),
  existing: vi.fn(),
  upsert: vi.fn(),
  audio: vi.fn(),
  prepare: vi.fn(),
  findConsentingUser: vi.fn(),
}));
vi.mock("@/server/trpc/trpc", () => ({ createContext: async () => ({ user: { id: "actor", organizationId: "org" }, impersonator: null }) }));
vi.mock("@/server/services/baamConversations", () => ({ ownBaamConversation: mocks.own }));
vi.mock("@/server/services/productImageStorage", () => ({
  uploadProductImageBuffer: mocks.upload,
  downloadRemoteImage: vi.fn(),
}));
vi.mock("@/server/services/baamAudio", () => ({ transcribeBaamAudio: mocks.audio }));
vi.mock("@/server/middleware/rateLimiter", () => ({
  createRateLimiter: () => ({ consume: async () => {} }),
}));
vi.mock("@/server/db/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findConsentingUser },
    baamAttachment: { findUnique: mocks.existing },
    $transaction: (run: (tx: unknown) => unknown) => run({
      $queryRaw: async () => [], baamConversation: { findFirst: async () => ({ id: "dialog" }) },
      baamAttachment: { upsert: mocks.upsert },
    }),
  },
}));
import { POST } from "@/app/api/baam/media/route";
vi.mock("@/server/services/productImageSourceUpload", () => ({
  prepareProductStudioSource: mocks.prepare,
}));
function request(bytes = "image", type = "image/png") {
  const form = new FormData();
  form.set("conversationId", "dialog");
  form.set("locale", "ru");
  form.set("kind", "image");
  form.set("file", new File([bytes], "photo.png", { type }));
  return new Request("https://bazaar.test/api/baam/media", {
    method: "POST",
    headers: { origin: "https://bazaar.test" },
    body: form,
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("BAAM_MEDIA_ENCRYPTION_KEY", Buffer.alloc(32, 18).toString("base64"));
  mocks.findConsentingUser.mockResolvedValue({ id: "actor", organizationId: "org", isActive: true, deletedAt: null,
    aiConsentVersion: AI_PRIVACY_CONSENT_VERSION, aiConsentGrantedAt: new Date(0), aiConsentRevokedAt: null });
  mocks.own.mockResolvedValue({ scope: { organizationId: "org" } });
  mocks.existing.mockResolvedValue(null);
  mocks.upload.mockResolvedValue({ url: "https://storage.test/image.png" });
  mocks.prepare.mockImplementation(async (file: File) => ({ buffer: Buffer.from(await file.arrayBuffer()), contentType: file.type }));
  mocks.upsert.mockImplementation(async ({ create }: { create: object }) => ({ id: "image", ...create }));
});
afterEach(() => vi.unstubAllEnvs());
describe("BAAM photo errors and retry boundary", () => {
  it("returns a decoding error instead of generic service unavailability", async () => {
    mocks.prepare.mockRejectedValue(new Error("imageInvalidType"));
    const response = await POST(request("invalid-heic", "image/heic"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "imageInvalidType" });
    expect(mocks.audio).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("does not label a multipart image limit as an audio error", async () => {
    const response = await POST(
      new Request("https://bazaar.test/api/baam/media", {
        method: "POST",
        headers: { "content-length": String(4 * 1024 * 1024) },
      }),
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ message: "baamMediaTooLarge" });
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("distinguishes an empty photo from an empty voice message", async () =>
    expect(await (await POST(request(""))).json()).toEqual({ message: "imageInvalidType" }));
  it("checks ownership before storing and never transcribes a photo", async () => {
    mocks.own.mockRejectedValue(new AppError("baamConversationNotFound", "NOT_FOUND", 404));
    expect((await POST(request())).status).toBe(404);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.audio).not.toHaveBeenCalled();
  });
  it("reuses an attachment for an identical retry within its conversation", async () => {
    await POST(request());
    const key = mocks.upsert.mock.calls[0][0].where.conversationId_contentHash;
    expect(key.conversationId).toBe("dialog");
    expect(key.contentHash).toMatch(/^[a-f0-9]{64}$/);
    mocks.existing.mockResolvedValue({ id: "image", name: "photo.png", mimeType: "image/png", url: "legacy-private-location" });
    expect(await (await POST(request())).json()).toEqual({ id: "image", name: "photo.png", mimeType: "image/png", url: "/api/baam/media?attachmentId=image" });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("does not expose raw storage errors", async () => {
    mocks.upsert.mockRejectedValue(new Error("private storage diagnostics"));
    expect(await (await POST(request())).json()).toEqual({ message: "baamMediaFailed" });
  });
});
