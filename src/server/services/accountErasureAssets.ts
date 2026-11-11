import { prisma } from "@/server/db/prisma";
import { deleteManagedAccountAsset } from "./productImageStorage";

// This durable queue contains only storage locations. The original identity is
// already erased. An unavailable storage provider cannot restore the account.
export const eraseAccountAssets = async () => {
  const assets = await prisma.accountErasureAsset.findMany({
    where: { nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: 25,
  });
  let deleted = 0, retained = 0, retrying = 0;
  for (const asset of assets) {
    try {
      // Content-addressed product uploads may be shared. Company assets and
      // another person's attachment are outside this account's deletion scope.
      const references = await Promise.all([
        prisma.productImage.count({ where: { url: asset.url } }),
        prisma.product.count({ where: { photoUrl: asset.url } }),
        prisma.baamAttachment.count({ where: { url: asset.url } }),
        prisma.productImageStudioJob.count({
          where: { OR: [{ sourceImageUrl: asset.url }, { outputImageUrl: asset.url }] },
        }),
      ]);
      if (references.some(Boolean)) {
        retained++;
      } else {
        await deleteManagedAccountAsset(asset.organizationId, asset.url);
        deleted++;
      }
      await prisma.accountErasureAsset.deleteMany({ where: { id: asset.id } });
    } catch {
      retrying++;
      await prisma.accountErasureAsset.updateMany({
        where: { id: asset.id },
        data: { attemptCount: { increment: 1 }, lastErrorCode: "accountAssetRetry",
          nextAttemptAt: new Date(Date.now() + Math.min(24 * 60 * 60_000, 60_000 * 2 ** Math.min(asset.attemptCount, 10))) },
      });
    }
  }
  return { job: "account-asset-erasure", status: "ok" as const, details: { deleted, retained, retrying } };
};
