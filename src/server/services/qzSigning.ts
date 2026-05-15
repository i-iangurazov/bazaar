import { createHash, createSign, createVerify } from "node:crypto";
import { readFileSync } from "node:fs";

const normalizePem = (value: string | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\\n/g, "\n");
};

const decodeBase64Pem = (value: string | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return Buffer.from(trimmed, "base64").toString("utf8").trim().replace(/\\n/g, "\n");
  } catch {
    return null;
  }
};

const readPemFile = (value: string | undefined) => {
  const filePath = value?.trim();
  if (!filePath) {
    return null;
  }
  try {
    return normalizePem(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

export const getQzTrayCertificate = () =>
  normalizePem(process.env.QZ_CERTIFICATE) ??
  decodeBase64Pem(process.env.QZ_CERTIFICATE_BASE64) ??
  readPemFile(process.env.QZ_CERTIFICATE_PATH) ??
  normalizePem(process.env.QZ_TRAY_CERTIFICATE) ??
  decodeBase64Pem(process.env.QZ_TRAY_CERTIFICATE_BASE64) ??
  readPemFile(process.env.QZ_TRAY_CERTIFICATE_PATH);

export const getQzTrayPrivateKey = () =>
  normalizePem(process.env.QZ_PRIVATE_KEY) ??
  decodeBase64Pem(process.env.QZ_PRIVATE_KEY_BASE64) ??
  readPemFile(process.env.QZ_PRIVATE_KEY_PATH) ??
  normalizePem(process.env.QZ_TRAY_PRIVATE_KEY) ??
  decodeBase64Pem(process.env.QZ_TRAY_PRIVATE_KEY_BASE64) ??
  readPemFile(process.env.QZ_TRAY_PRIVATE_KEY_PATH);

export const getQzSigningStatus = () => {
  const certificate = getQzTrayCertificate();
  const privateKey = getQzTrayPrivateKey();
  const keyPairMatches = certificate && privateKey ? qzKeyPairMatches(certificate, privateKey) : null;
  return {
    certificateConfigured: Boolean(certificate),
    privateKeyConfigured: Boolean(privateKey),
    signingConfigured: Boolean(certificate && privateKey),
    keyPairMatches,
    certificateFingerprintSha256: certificate ? qzCertificateFingerprint(certificate) : null,
  };
};

const qzCertificateFingerprint = (certificate: string) => {
  const der = pemToDer(certificate) ?? Buffer.from(certificate.trim(), "utf8");
  const hex = createHash("sha256").update(der).digest("hex").toUpperCase();
  return hex.match(/.{1,2}/g)?.join(":") ?? hex;
};

const pemToDer = (certificate: string) => {
  const match = certificate.match(/-----BEGIN [^-]+-----([\s\S]*?)-----END [^-]+-----/);
  if (!match?.[1]) {
    return null;
  }
  try {
    return Buffer.from(match[1].replace(/\s/g, ""), "base64");
  } catch {
    return null;
  }
};

const qzKeyPairMatches = (certificate: string, privateKey: string) => {
  try {
    const payload = "bazaar-qz-key-pair-check";
    const signer = createSign("sha512");
    signer.update(payload, "utf8");
    signer.end();
    const signature = signer.sign(privateKey, "base64");
    const verifier = createVerify("sha512");
    verifier.update(payload, "utf8");
    verifier.end();
    return verifier.verify(certificate, signature, "base64");
  } catch {
    return false;
  }
};

export const signQzTrayRequest = (payload: string) => {
  const privateKey = getQzTrayPrivateKey();
  if (!privateKey) {
    throw new Error("qzSigningNotConfigured");
  }
  const signer = createSign("sha512");
  signer.update(payload, "utf8");
  signer.end();
  return signer.sign(privateKey, "base64");
};
