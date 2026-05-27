type StoredZip = { data: ArrayBuffer; filename: string; expiresAt: number };

// Module-level store shared across requests on the same server instance.
// Works for traditional Node.js / Docker deployments (not edge/serverless).
export const imageExportStore = new Map<string, StoredZip>();

const ZIP_TTL_MS = 10 * 60 * 1000; // 10 minutes

export const storeZip = (token: string, data: ArrayBuffer, filename: string) => {
  purgeExpired();
  imageExportStore.set(token, { data, filename, expiresAt: Date.now() + ZIP_TTL_MS });
};

export const consumeZip = (token: string): StoredZip | undefined => {
  const entry = imageExportStore.get(token);
  imageExportStore.delete(token);
  return entry;
};

const purgeExpired = () => {
  const now = Date.now();
  for (const [key, value] of imageExportStore) {
    if (value.expiresAt < now) imageExportStore.delete(key);
  }
};
