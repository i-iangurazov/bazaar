type ZipOwner = { userId: string; organizationId: string };

type StoredZip = {
  data: ArrayBuffer;
  filename: string;
  expiresAt: number;
  userId: string;
  organizationId: string;
};

// Module-level store shared across requests on the same server instance.
// Works for traditional Node.js / Docker deployments (not edge/serverless).
export const imageExportStore = new Map<string, StoredZip>();

const ZIP_TTL_MS = 10 * 60 * 1000; // 10 minutes

export const storeZip = (
  token: string,
  data: ArrayBuffer,
  filename: string,
  owner: ZipOwner,
) => {
  purgeExpired();
  imageExportStore.set(token, {
    data,
    filename,
    expiresAt: Date.now() + ZIP_TTL_MS,
    ...owner,
  });
};

export const consumeZip = (token: string, owner: ZipOwner): StoredZip | undefined => {
  const entry = imageExportStore.get(token);
  if (
    !entry ||
    entry.userId !== owner.userId ||
    entry.organizationId !== owner.organizationId
  ) {
    return undefined;
  }
  imageExportStore.delete(token);
  return entry;
};

const purgeExpired = () => {
  const now = Date.now();
  for (const [key, value] of imageExportStore) {
    if (value.expiresAt < now) imageExportStore.delete(key);
  }
};
