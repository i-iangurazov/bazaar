import { createSign } from "node:crypto";

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

export const getQzTrayCertificate = () =>
  normalizePem(process.env.QZ_TRAY_CERTIFICATE) ??
  decodeBase64Pem(process.env.QZ_TRAY_CERTIFICATE_BASE64);

export const getQzTrayPrivateKey = () =>
  normalizePem(process.env.QZ_TRAY_PRIVATE_KEY) ??
  decodeBase64Pem(process.env.QZ_TRAY_PRIVATE_KEY_BASE64);

export const getQzSigningStatus = () => {
  const certificate = getQzTrayCertificate();
  const privateKey = getQzTrayPrivateKey();
  return {
    certificateConfigured: Boolean(certificate),
    privateKeyConfigured: Boolean(privateKey),
    signingConfigured: Boolean(certificate && privateKey),
  };
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
