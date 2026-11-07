import { BazaarCatalogStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { whatsappSearch } from "@/server/whatsapp/catalog";
import {
  createCatalogCheckoutOrder,
  getPublicBazaarCatalog,
  upsertBazaarCatalogSettings,
} from "@/server/services/bazaarCatalog";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

vi.mock("@/server/events/eventBus", () => ({ eventBus: { publish: vi.fn() } }));
vi.mock("@/server/services/orderEmails", () => ({
  sendOrderConfirmationEmail: vi.fn(async () => ({ status: "sent" })),
}));

type PriceCase = {
  name: string;
  variant?: boolean;
  baseRow?: number;
  exactRow?: number;
  baseDiscount?: number;
  exactDiscount?: number;
  retail?: number | null;
  wholesale?: number | null;
  productBase: number;
  expected: number;
};
const cases: PriceCase[] = [
  {
    name: "BASE public discount with a different retail price",
    productBase: 100,
    baseRow: 250,
    baseDiscount: 10,
    retail: 300,
    expected: 225,
  },
  {
    name: "variant inherits BASE price and its discount",
    variant: true,
    productBase: 100,
    baseRow: 200,
    baseDiscount: 10,
    retail: 300,
    expected: 180,
  },
  {
    name: "variant falls back to product without exposing wholesale",
    variant: true,
    productBase: 100,
    wholesale: 60,
    expected: 100,
  },
  {
    name: "exact variant price and discount override BASE together",
    variant: true,
    productBase: 100,
    baseRow: 200,
    baseDiscount: 10,
    exactRow: 210,
    exactDiscount: 20,
    retail: 300,
    expected: 168,
  },
  {
    name: "explicit zero variant price",
    variant: true,
    productBase: 100,
    baseRow: 200,
    exactRow: 0,
    wholesale: 60,
    expected: 0,
  },
  {
    name: "unpublished zero retail price does not replace public price",
    productBase: 100,
    baseRow: 250,
    baseDiscount: 10,
    retail: 0,
    expected: 225,
  },
  { name: "explicit zero BASE price", productBase: 100, baseRow: 0, retail: 300, expected: 0 },
  {
    name: "explicit zero product fallback for a variant",
    variant: true,
    productBase: 0,
    wholesale: 60,
    expected: 0,
  },
];

(shouldRunDbTests ? describe : describe.skip)(
  "WhatsApp prices agree with the public purchasing channel",
  () => {
    beforeEach(resetDatabase);

    it.each(cases)("$name", async (item) => {
      const f = await seedBase();
      await prisma.organization.update({
        where: { id: f.org.id },
        data: { retailWholesaleEnabled: true },
      });
      await prisma.product.update({
        where: { id: f.product.id },
        data: { basePriceKgs: item.productBase },
      });
      const variant = item.variant
        ? await prisma.productVariant.create({
            data: { productId: f.product.id, name: "125 мм", attributes: {}, isActive: true },
          })
        : null;
      if (item.baseRow !== undefined) {
        await prisma.storePrice.create({
          data: {
            organizationId: f.org.id,
            storeId: f.store.id,
            productId: f.product.id,
            variantKey: "BASE",
            priceKgs: item.baseRow,
            discountType: item.baseDiscount ? "PERCENTAGE" : null,
            discountPercentage: item.baseDiscount ?? null,
          },
        });
      }
      if (variant && item.exactRow !== undefined) {
        await prisma.storePrice.create({
          data: {
            organizationId: f.org.id,
            storeId: f.store.id,
            productId: f.product.id,
            variantKey: variant.id,
            variantId: variant.id,
            priceKgs: item.exactRow,
            discountType: item.exactDiscount ? "PERCENTAGE" : null,
            discountPercentage: item.exactDiscount ?? null,
          },
        });
      }
      await prisma.storePriceTypes.create({
        data: {
          organizationId: f.org.id,
          storeId: f.store.id,
          productId: f.product.id,
          variantKey: variant?.id ?? "BASE",
          variantId: variant?.id ?? null,
          retailPriceKgs: item.retail ?? null,
          wholesalePriceKgs: item.wholesale ?? null,
        },
      });
      const saved = await upsertBazaarCatalogSettings({
        organizationId: f.org.id,
        storeId: f.store.id,
        actorId: f.adminUser.id,
        requestId: "whatsapp-price-channel",
        status: BazaarCatalogStatus.PUBLISHED,
      });
      const offers = await whatsappSearch(f.org.id, f.store.id, { query: f.product.sku });
      expect(offers).toHaveLength(1);
      expect(offers[0].price).toBe(item.expected.toFixed(2));
      expect(offers[0].link).toContain(saved.catalog.publicUrlPath);
      expect(offers[0]).not.toHaveProperty("wholesalePriceKgs");
      expect(offers[0]).not.toHaveProperty("avgCostKgs");

      const published = await getPublicBazaarCatalog(saved.catalog.slug);
      const publicProduct = published?.products.find((product) => product.id === f.product.id);
      const publicPrice = variant
        ? publicProduct?.variants.find((row) => row.id === variant.id)?.quotedUnitPriceKgs
        : publicProduct?.quotedUnitPriceKgs;
      expect(publicPrice).toBe(Number(offers[0].price));

      // The unchanged public checkout accepts the amount that the assistant
      // quotes, and persists that exact price. No external payments or emails run.
      const order = await createCatalogCheckoutOrder({
        slug: saved.catalog.slug,
        customerName: "Synthetic WhatsApp Customer",
        customerEmail: "whatsapp-price@example.test",
        customerPhone: "+996700000123",
        lines: [
          {
            productId: f.product.id,
            variantId: variant?.id ?? null,
            qty: 2,
            quotedUnitPriceKgs: Number(offers[0].price),
          },
        ],
      });
      const line = await prisma.customerOrderLine.findFirstOrThrow({
        where: { customerOrderId: order.id },
      });
      expect(line.unitPriceKgs.toFixed(2)).toBe(offers[0].price);
      expect(line.lineTotalKgs.toFixed(2)).toBe((item.expected * 2).toFixed(2));
    });

    it("does not invent a free price when the public price is unconfigured", async () => {
      const f = await seedBase();
      await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: null } });
      await prisma.storePriceTypes.create({
        data: {
          organizationId: f.org.id,
          storeId: f.store.id,
          productId: f.product.id,
          retailPriceKgs: 300,
          wholesalePriceKgs: 60,
        },
      });
      const [offer] = await whatsappSearch(f.org.id, f.store.id, { query: f.product.sku });
      expect(offer.price).toBeNull();
      expect(await prisma.customerOrder.count()).toBe(0);
    });
  },
);
