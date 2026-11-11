import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BAAM_PRIVATE_MEDIA_PREFIX, baamAttachmentHref, decryptBaamMedia, encryptBaamMedia } from "@/server/services/baamPrivateMedia";

const scope = { organizationId: "synthetic-org", conversationId: "synthetic-conversation", mimeType: "image/png" };
const bytes = Buffer.from("Synthetic private image content");

describe("private BAAM media encryption", () => {
  beforeEach(() => vi.stubEnv("BAAM_MEDIA_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64")));
  afterEach(() => vi.unstubAllEnvs());

  it("encrypts with unique nonces and authenticates bytes, organization, conversation and media type", () => {
    const first = encryptBaamMedia(bytes, scope), second = encryptBaamMedia(bytes, scope);
    expect(first.startsWith(BAAM_PRIVATE_MEDIA_PREFIX)).toBe(true);
    expect(first).not.toBe(second);
    expect(decryptBaamMedia(first, scope)).toEqual(bytes);
    for (const changed of [{ ...scope, organizationId: "other" }, { ...scope, conversationId: "other" }, { ...scope, mimeType: "image/jpeg" }])
      expect(() => decryptBaamMedia(first, changed)).toThrow("baamAttachmentNotFound");
    const tampered = Buffer.from(first.slice(BAAM_PRIVATE_MEDIA_PREFIX.length), "base64url");
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptBaamMedia(BAAM_PRIVATE_MEDIA_PREFIX + tampered.toString("base64url"), scope)).toThrow("baamAttachmentNotFound");
    expect(baamAttachmentHref("owned-attachment")).toBe("/api/baam/media?attachmentId=owned-attachment");
  });

  it("fails closed without a valid dedicated key, and rejects oversized or non-image inputs", () => {
    for (const key of ["", "short", Buffer.alloc(16).toString("base64"), "x".repeat(100)]) {
      vi.stubEnv("BAAM_MEDIA_ENCRYPTION_KEY", key);
      expect(() => encryptBaamMedia(bytes, scope)).toThrow("baamPrivateMediaNotConfigured");
    }
    vi.stubEnv("BAAM_MEDIA_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    expect(() => encryptBaamMedia(bytes, { ...scope, mimeType: "image/svg+xml" })).toThrow("imageInvalidType");
    expect(() => encryptBaamMedia(Buffer.alloc(3 * 1024 * 1024 + 1), scope)).toThrow("imageInvalidType");
    expect(() => decryptBaamMedia("baam-private:v1:invalid", scope)).toThrow("baamAttachmentNotFound");
  });
});
