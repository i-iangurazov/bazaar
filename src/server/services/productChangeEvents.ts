import { prisma } from "@/server/db/prisma";
import { eventBus } from "@/server/events/eventBus";
import { getLogger } from "@/server/logging";

/** Call after commit. A failed notification must never turn a saved card into a failed save. */
export async function publishProductChange(organizationId: string, productId: string) {
  try {
    const assignments = await prisma.storeProduct.findMany({
      where: { organizationId, productId, isActive: true, isHidden: false },
      select: { storeId: true },
    });
    const [{ invalidateBazaarCatalogCacheForStore }, { invalidateBazaarApiProductsCacheForStore }] =
      await Promise.all([import("./bazaarCatalog"), import("./bazaarApi")]);
    await Promise.all(
      assignments.map(async ({ storeId }) => {
        try {
          eventBus.publish({ type: "products.updated", payload: { storeId, productId } });
          await Promise.all([
            invalidateBazaarCatalogCacheForStore(organizationId, storeId),
            invalidateBazaarApiProductsCacheForStore(organizationId, storeId),
          ]);
        } catch {
          getLogger().warn({ storeId, productId }, "committed product notification failed");
        }
      }),
    );
  } catch {
    getLogger().warn({ organizationId, productId }, "could not publish committed product change");
  }
}
