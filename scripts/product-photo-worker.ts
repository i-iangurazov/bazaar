import { prisma } from "../src/server/db/prisma";
import { processNextProductPhoto, pruneObsoleteProductPhotos } from "../src/server/services/productPhotoSearchWorker";
import { publishPhotoWorkerHealth, removePhotoWorkerHealth } from "../src/server/services/productPhotoWorkerHealth";

const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());
let lastOrganization: string | undefined;
let lastCleanup = 0;
let lastHeartbeat = 0;
const healthFile = process.env.PRODUCT_PHOTO_WORKER_HEALTH_FILE;
try {
  while (!stop.signal.aborted) {
    try {
      const organization = await processNextProductPhoto({ skipOrganizationId: lastOrganization, signal: stop.signal });
      if (healthFile && Date.now() - lastHeartbeat > 5000) {
        await publishPhotoWorkerHealth(healthFile, Date.now());
        lastHeartbeat = Date.now();
      }
      if (organization) lastOrganization = organization;
      if (Date.now() - lastCleanup > 60_000) { await pruneObsoleteProductPhotos(); lastCleanup = Date.now(); }
      if (!organization) await new Promise((resolve) => setTimeout(resolve, 500));
    } catch {
      if (!stop.signal.aborted) { process.stderr.write("Photo preparation temporarily unavailable; retrying.\n"); await new Promise((resolve) => setTimeout(resolve, 2000)); }
    }
  }
} finally {
  if (healthFile) await removePhotoWorkerHealth(healthFile);
  await prisma.$disconnect();
}
