import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("qz signing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports signing as missing when certificate or key is absent", async () => {
    vi.stubEnv("QZ_TRAY_CERTIFICATE", "");
    vi.stubEnv("QZ_TRAY_CERTIFICATE_BASE64", "");
    vi.stubEnv("QZ_TRAY_PRIVATE_KEY", "");
    vi.stubEnv("QZ_TRAY_PRIVATE_KEY_BASE64", "");

    vi.resetModules();
    const { getQzSigningStatus } = await import("@/server/services/qzSigning");

    expect(getQzSigningStatus()).toEqual({
      certificateConfigured: false,
      privateKeyConfigured: false,
      signingConfigured: false,
    });
  });

  it("signs QZ challenges without exposing the private key to the client", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    vi.stubEnv("QZ_TRAY_CERTIFICATE", publicKey.replace(/\n/g, "\\n"));
    vi.stubEnv("QZ_TRAY_PRIVATE_KEY", privateKey.replace(/\n/g, "\\n"));

    vi.resetModules();
    const { getQzSigningStatus, signQzTrayRequest } = await import("@/server/services/qzSigning");

    expect(getQzSigningStatus().signingConfigured).toBe(true);

    const payload = "qz-challenge";
    const signature = signQzTrayRequest(payload);
    const verifier = createVerify("sha512");
    verifier.update(payload, "utf8");
    verifier.end();

    expect(verifier.verify(publicKey, signature, "base64")).toBe(true);
  });
});
