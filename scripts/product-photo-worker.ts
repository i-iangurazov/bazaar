import { prisma } from "../src/server/db/prisma";
import { processNextProductPhoto, pruneObsoleteProductPhotos } from "../src/server/services/productPhotoSearchWorker";

const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());
let lastOrganization: string | undefined;
let lastCleanup = 0;
try {
  while (!stop.signal.aborted) {
    try {
      const organization = await processNextProductPhoto({ skipOrganizationId: lastOrganization, signal: stop.signal });
      if (organization) lastOrganization = organization;
      if (Date.now() - lastCleanup > 60_000) { await pruneObsoleteProductPhotos(); lastCleanup = Date.now(); }
      if (!organization) await new Promise((resolve) => setTimeout(resolve, 500));
    } catch {
      if (!stop.signal.aborted) { process.stderr.write("Photo preparation temporarily unavailable; retrying.\n"); await new Promise((resolve) => setTimeout(resolve, 2000)); }
    }
  }
} finally { await prisma.$disconnect(); }
