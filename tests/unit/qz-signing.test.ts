import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const clearQzEnv = () => {
  [
    "QZ_CERTIFICATE",
    "QZ_CERTIFICATE_BASE64",
    "QZ_CERTIFICATE_PATH",
    "QZ_PRIVATE_KEY",
    "QZ_PRIVATE_KEY_BASE64",
    "QZ_PRIVATE_KEY_PATH",
    "QZ_TRAY_CERTIFICATE",
    "QZ_TRAY_CERTIFICATE_BASE64",
    "QZ_TRAY_CERTIFICATE_PATH",
    "QZ_TRAY_PRIVATE_KEY",
    "QZ_TRAY_PRIVATE_KEY_BASE64",
    "QZ_TRAY_PRIVATE_KEY_PATH",
  ].forEach((key) => vi.stubEnv(key, ""));
};

describe("qz signing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports signing as missing when certificate or key is absent", async () => {
    clearQzEnv();

    vi.resetModules();
    const { getQzSigningStatus } = await import("@/server/services/qzSigning");

    expect(getQzSigningStatus()).toEqual({
      certificateConfigured: false,
      privateKeyConfigured: false,
      signingConfigured: false,
      keyPairMatches: null,
      certificateFingerprintSha256: null,
    });
  });

  it("signs QZ challenges without exposing the private key to the client", async () => {
    clearQzEnv();
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    vi.stubEnv("QZ_CERTIFICATE", publicKey.replace(/\n/g, "\\n"));
    vi.stubEnv("QZ_PRIVATE_KEY", privateKey.replace(/\n/g, "\\n"));

    vi.resetModules();
    const { getQzSigningStatus, signQzTrayRequest } = await import("@/server/services/qzSigning");

    expect(getQzSigningStatus()).toEqual({
      certificateConfigured: true,
      privateKeyConfigured: true,
      signingConfigured: true,
      keyPairMatches: true,
      certificateFingerprintSha256: expect.stringMatching(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/),
    });

    const payload = "qz-challenge";
    const signature = signQzTrayRequest(payload);
    const verifier = createVerify("sha512");
    verifier.update(payload, "utf8");
    verifier.end();

    expect(verifier.verify(publicKey, signature, "base64")).toBe(true);
  });

  it("loads QZ certificate and private key from server-only paths", async () => {
    clearQzEnv();
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const dir = await mkdtemp(path.join(tmpdir(), "bazaar-qz-"));
    const certPath = path.join(dir, "qz-public.pem");
    const keyPath = path.join(dir, "qz-private.pem");

    try {
      await writeFile(certPath, publicKey, "utf8");
      await writeFile(keyPath, privateKey, "utf8");
      vi.stubEnv("QZ_CERTIFICATE_PATH", certPath);
      vi.stubEnv("QZ_PRIVATE_KEY_PATH", keyPath);

      vi.resetModules();
      const { getQzSigningStatus, signQzTrayRequest } = await import("@/server/services/qzSigning");

      expect(getQzSigningStatus()).toEqual({
        certificateConfigured: true,
        privateKeyConfigured: true,
        signingConfigured: true,
        keyPairMatches: true,
        certificateFingerprintSha256: expect.stringMatching(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/),
      });

      const payload = "qz-path-challenge";
      const signature = signQzTrayRequest(payload);
      const verifier = createVerify("sha512");
      verifier.update(payload, "utf8");
      verifier.end();

      expect(verifier.verify(publicKey, signature, "base64")).toBe(true);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("reports a mismatch when certificate and private key are not a pair", async () => {
    clearQzEnv();
    const { publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    vi.stubEnv("QZ_CERTIFICATE", publicKey.replace(/\n/g, "\\n"));
    vi.stubEnv("QZ_PRIVATE_KEY", privateKey.replace(/\n/g, "\\n"));

    vi.resetModules();
    const { getQzSigningStatus } = await import("@/server/services/qzSigning");

    expect(getQzSigningStatus()).toEqual({
      certificateConfigured: true,
      privateKeyConfigured: true,
      signingConfigured: true,
      keyPairMatches: false,
      certificateFingerprintSha256: expect.stringMatching(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/),
    });
  });
});
