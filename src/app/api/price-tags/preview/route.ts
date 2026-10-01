import { cookies } from "next/headers";
import { getServerAuthToken } from "@/server/auth/token";
import { prisma } from "@/server/db/prisma";
import { assertUserCanAccessStore } from "@/server/services/storeAccess";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import { buildPriceTagsPdf } from "@/server/services/priceTagsPdf";
import { AppError } from "@/server/services/errors";
import { labelPreviewSchema } from "@/lib/labelPreview";
import { normalizeLocale, toIntlLocale, defaultLocale } from "@/lib/locales";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const token = await getServerAuthToken();
  if (!token?.sub || !token.organizationId) return Response.json({ message: "unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ message: "forbidden" }, { status: 403 });
  const parsed = labelPreviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "invalidInput" }, { status: 400 });
  try {
    const input = parsed.data;
    await assertFeatureEnabled({ organizationId: String(token.organizationId), feature: "priceTags" });
    await assertUserCanAccessStore(prisma, { id: token.sub, organizationId: String(token.organizationId), role: String(token.role), isOrgOwner: Boolean(token.isOrgOwner), isPlatformOwner: Boolean(token.isPlatformOwner) }, input.storeId);
    const store = await prisma.store.findUniqueOrThrow({ where: { id: input.storeId }, select: { name: true, currencyCode: true, currencyRateKgsPerUnit: true } });
    const locale = normalizeLocale(cookies().get("NEXT_LOCALE")?.value) ?? defaultLocale;
    const messages = (await import(`../../../../../messages/${locale}.json`)).default;
    const warnings: string[] = [];
    const pdf = await buildPriceTagsPdf({ ...input,
      labels: [input.sample ?? { name: messages.printingSettings.sampleProductName, price: 1234.5, sku: "DEMO-001", barcode: "0001234567895" }],
      locale: toIntlLocale(locale), storeName: store.name, currencyCode: store.currencyCode, currencyRateKgsPerUnit: store.currencyRateKgsPerUnit.toString(),
      noPriceLabel: messages.priceTags.noPrice, noBarcodeLabel: messages.priceTags.noBarcode, skuLabel: messages.priceTags.sku,
      rollCalibration: { widthMm: input.widthMm, heightMm: input.heightMm, xOffsetMm: input.xOffsetMm, yOffsetMm: input.yOffsetMm, gapMm: 0 },
      layoutWarnings: warnings, allowOverflowPreview: true,
    });
    return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store", "X-Label-Warnings": [...new Set(warnings)].join(",") } });
  } catch (error) {
    return Response.json({ message: error instanceof AppError ? error.message : "genericMessage" }, { status: error instanceof AppError ? error.status : 500 });
  }
}
