import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { readBaamAccessScope } from "@/server/services/baamMetrics";
import { productPlanSchema, type BaamProductPlan } from "@/server/services/baamProductPlan";
import { AppError } from "@/server/services/errors";
import { resolveSalesAnalyticsDateRange, type SalesAnalyticsDateInput } from "@/server/services/salesAnalytics";

export type BaamProductCard = {
  id: string;
  title: string;
  href: string;
  sku: string | null;
  displayFields: Array<{ label: string; value: string }>;
};
export type BaamProductEvidence = { summary: string; details: string[]; appliedPeriod: boolean };
export type BaamProductResult = {
  status: "answer" | "clarification";
  answer: string;
  cards: BaamProductCard[];
  evidence: BaamProductEvidence;
  contextProductId?: string;
};

const copy = {
  en: {
    catalog: "Current catalog", performance: "Product sales and returns", ranking: "Product sales ranking", zero: "Products without completed sales",
    scope: "Stores", noStores: "No accessible stores", snapshot: "Read at", period: "Period",
    population: "Population: current, nonarchived products actively assigned to the selected accessible stores. Each product appears once; variants are combined.",
    count: "Products in this population", matches: "Matching products", shown: "Shown",
    current: "Catalog fields describe the current product, not its state during the selected dates. The date filter is not applied to catalog search or details.",
    source: "Completed, nonheld sales and completed returns, each dated by its own completion time, in Asia/Bishkek. Only the existing completed-sales reporting channel is included.",
    measure: "Net line revenue = recorded sale-line totals minus return-line totals, in KGS. Order-wide adjustments are not allocated; this can differ from the sales overview. Net quantity = sold quantity minus returned quantity, in each product's recorded base unit.",
    limits: "Quantities with different base units are not directly comparable. This is recorded activity, not profit, stock, availability, demand, or a cause. Catalog assignments are current; archived and unassigned products are excluded.",
    zeroRule: "Without completed sales means zero qualifying sold quantity in this period. A product may still have returns from earlier sales; this does not prove it was offered throughout the period.",
    top: "Highest first", bottom: "Lowest first (including zero and negative values)", netRevenue: "Net line revenue", netUnits: "Net quantity",
    sold: "Sold quantity", returned: "Returned quantity", unit: "Base unit", category: "Category", barcode: "Barcode", price: "Current base price", missing: "Not set",
    pick: "Choose a product from the matching cards, or provide its exact SKU or barcode.", noMatch: "No matching product was found in this accessible catalog population.",
    needProduct: "Open a product page or provide a product name, SKU, or barcode so I can identify it safely.",
  },
  ru: {
    catalog: "Текущий каталог", performance: "Продажи и возвраты товара", ranking: "Рейтинг продаж товаров", zero: "Товары без завершённых продаж",
    scope: "Магазины", noStores: "Нет доступных магазинов", snapshot: "Время чтения", period: "Период",
    population: "Выборка: текущие неархивные товары с активной привязкой к выбранным доступным магазинам. Каждый товар учитывается один раз; варианты объединены.",
    count: "Товаров в выборке", matches: "Найдено товаров", shown: "Показано",
    current: "Поля каталога описывают товар сейчас, а не в выбранном периоде. Фильтр дат не применяется к поиску и карточке товара.",
    source: "Завершённые неотложенные продажи и завершённые возвраты учитываются по времени завершения каждого события, Asia/Bishkek. Включён только канал существующего отчёта завершённых продаж.",
    measure: "Чистая выручка строк = суммы строк продаж минус суммы строк возвратов, в KGS. Общие корректировки заказа не распределяются; итог может отличаться от обзора продаж. Чистое количество = проданное минус возвращённое, в базовой единице каждого товара.",
    limits: "Количество в разных единицах нельзя сравнивать напрямую. Это учтённые операции, а не прибыль, остатки, доступность, спрос или причины. Привязки к магазинам текущие; архивные и непривязанные товары исключены.",
    zeroRule: "Без завершённых продаж означает нулевое проданное количество в этом периоде. Возможны возвраты прежних продаж; это не доказывает, что товар предлагался весь период.",
    top: "Сначала наибольшие значения", bottom: "Сначала наименьшие значения (включая нули и отрицательные)", netRevenue: "Чистая выручка строк", netUnits: "Чистое количество",
    sold: "Проданное количество", returned: "Возвращённое количество", unit: "Базовая единица", category: "Категория", barcode: "Штрихкод", price: "Текущая базовая цена", missing: "Не указано",
    pick: "Выберите товар из карточек или укажите точный артикул либо штрихкод.", noMatch: "В доступной выборке каталога подходящих товаров не найдено.",
    needProduct: "Откройте страницу товара или укажите название, артикул либо штрихкод, чтобы я мог определить товар точно.",
  },
  kg: {
    catalog: "Учурдагы каталог", performance: "Товардын сатуулары жана кайтаруулары", ranking: "Товарлардын сатуу рейтинги", zero: "Аяктаган сатуусу жок товарлар",
    scope: "Дүкөндөр", noStores: "Жеткиликтүү дүкөн жок", snapshot: "Окулган убакыт", period: "Мезгил",
    population: "Тандоо: тандалган жеткиликтүү дүкөндөргө активдүү байланышы бар, архивделбеген учурдагы товарлар. Ар бир товар бир жолу эсептелет; варианттар бириктирилет.",
    count: "Тандоодогу товарлар", matches: "Табылган товарлар", shown: "Көрсөтүлдү",
    current: "Каталог талаалары тандалган мезгилди эмес, товардын азыркы абалын сүрөттөйт. Дата чыпкасы товар издөөгө жана маалыматтарына колдонулбайт.",
    source: "Аяктаган, кийинкиге калтырылбаган сатуулар жана аяктаган кайтаруулар ар бир окуянын аяктоо убактысы боюнча эсептелет, Asia/Bishkek. Аяктаган сатуулар отчётунун учурдагы каналы гана камтылган.",
    measure: "Саптардын таза кирешеси = сатуу саптарынын суммасы минус кайтаруу саптарынын суммасы, KGS. Буйрутманын жалпы түзөтүүлөрү бөлүштүрүлбөйт; жыйынтык сатуу серебинен айырмаланышы мүмкүн. Таза сан = сатылган сан минус кайтарылган сан, ар бир товардын базалык бирдигинде.",
    limits: "Ар башка бирдиктеги сандар түз салыштырылбайт. Бул катталган аракеттер; пайда, калдык, жеткиликтүүлүк, суроо-талап же себеп эмес. Дүкөнгө байланыштар учурдагы; архивделген жана байланышы жок товарлар кирбейт.",
    zeroRule: "Аяктаган сатуусу жок деген ушул мезгилде сатылган саны нөл дегенди билдирет. Мурунку сатуудан кайтаруулар болушу мүмкүн; товар бүт мезгилде сунушталганын далилдебейт.",
    top: "Эң чоң маанилер биринчи", bottom: "Эң кичине маанилер биринчи (нөл жана терс маанилер кошо)", netRevenue: "Саптардын таза кирешеси", netUnits: "Таза сан",
    sold: "Сатылган сан", returned: "Кайтарылган сан", unit: "Базалык бирдик", category: "Категория", barcode: "Штрихкод", price: "Учурдагы базалык баа", missing: "Көрсөтүлгөн эмес",
    pick: "Карточкадан товар тандаңыз же так артикулун же штрихкодун жазыңыз.", noMatch: "Каталогдун жеткиликтүү тандоосунда дал келген товар табылган жок.",
    needProduct: "Товарды так аныктоо үчүн анын барагын ачыңыз же атын, артикулун же штрихкодун жазыңыз.",
  },
} as const;

type ProductRow = {
  id: string; name: string; sku: string; unit: string; category: string | null;
  barcode: string | null; basePriceKgs: Prisma.Decimal | null;
  quantitySold: Prisma.Decimal; quantityReturned: Prisma.Decimal; netQuantity: Prisma.Decimal;
  netRevenueKgs: Prisma.Decimal; total: number; population: number;
};

// Parameter binding is used for IDs, queries, dates and limits. The only SQL
// fragments selected dynamically below come from finite, validated enums.
export const executeBaamProductPlan = async (input: {
  actorId: string; range: SalesAnalyticsDateInput; storeId?: string;
  plan: BaamProductPlan; locale: "en" | "ru" | "kg"; pageProductId?: string;
}): Promise<BaamProductResult> => {
  const parsed = productPlanSchema.safeParse(input.plan);
  if (!parsed.success) throw new AppError("invalidInput", "BAD_REQUEST", 400);
  const plan = parsed.data;
  const range = resolveSalesAnalyticsDateRange(input.range);
  const singleProduct = plan.productAction === "details" || plan.productAction === "performance";
  const dated = plan.productAction === "ranking" || plan.productAction === "zero_sales" || plan.productAction === "performance";
  const query = plan.query;
  if ((plan.productAction === "ranking" && (!plan.direction || !plan.metric || query)) ||
      (plan.productAction !== "ranking" && (plan.direction || plan.metric)) ||
      (plan.productAction === "zero_sales" && query)) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  const c = copy[input.locale];
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const access = await readBaamAccessScope(tx, input.actorId, input.storeId);
    const selectedStores = access.availableStores.filter(store => access.storeIds.includes(store.id));
    const queriedAt = new Date().toISOString();
    const evidence: BaamProductEvidence = {
      summary: plan.productAction === "performance" ? c.performance : dated ? c.ranking : c.catalog,
      appliedPeriod: dated,
      details: [
        `${c.scope}: ${selectedStores.map(store => store.name).join(", ") || c.noStores}`,
        ...(dated ? [`${c.period}: ${range.dateFrom} — ${range.dateTo} (${range.timeZone})`, c.source] : [c.current]),
        c.population,
        ...(dated ? [c.measure, c.limits, ...(plan.productAction === "zero_sales" ? [c.zeroRule] : [])] : []),
        `${c.snapshot}: ${queriedAt}`,
      ],
    };
    if (singleProduct && !query && !input.pageProductId) {
      return { status: "clarification", answer: c.needProduct, cards: [], evidence };
    }
    // A missing/stale/foreign product reference never broadens to all products.
    const targetId = singleProduct && !query ? input.pageProductId : undefined;
    if (targetId && !/^[A-Za-z0-9_-]{1,128}$/.test(targetId)) {
      throw new AppError("productAccessDenied", "FORBIDDEN", 403);
    }
    const productScope = Prisma.sql`p."organizationId" = ${access.organizationId}
      AND p."isDeleted" = false AND EXISTS (
        SELECT 1 FROM "StoreProduct" sp WHERE sp."productId" = p.id
          AND sp."organizationId" = ${access.organizationId} AND sp."isActive" = true
          AND ${access.storeIds.length ? Prisma.sql`sp."storeId" IN (${Prisma.join(access.storeIds)})` : Prisma.sql`false`}
      )`;
    const pattern = query ? `%${query.replace(/[\\%_]/g, "\\$&")}%` : null;
    const search = targetId ? Prisma.sql`AND p.id = ${targetId}` : query ? Prisma.sql`AND (
      p.name ILIKE ${pattern} OR p.sku ILIKE ${pattern} OR EXISTS (
        SELECT 1 FROM "ProductBarcode" pb WHERE pb."productId" = p.id
          AND pb."organizationId" = ${access.organizationId} AND pb.value ILIKE ${pattern}
      )
    )` : Prisma.empty;
    const activity = dated ? Prisma.sql`
      SELECT l."productId", l.qty::numeric AS sold, 0::numeric AS returned,
        l."lineTotalKgs" AS revenue, 0::numeric AS refunds
      FROM "CustomerOrderLine" l JOIN "CustomerOrder" o ON o.id = l."customerOrderId"
      WHERE o."organizationId" = ${access.organizationId}
        AND ${access.storeIds.length ? Prisma.sql`o."storeId" IN (${Prisma.join(access.storeIds)})` : Prisma.sql`false`}
        AND o."isPosSale" = true AND o."isHeld" = false AND o.status::text = 'COMPLETED'
        AND o."completedAt" >= ${range.fromUtc} AND o."completedAt" < ${range.toUtcExclusive}
      UNION ALL
      SELECT rl."productId", 0::numeric, rl.qty::numeric, 0::numeric, rl."lineTotalKgs"
      FROM "SaleReturnLine" rl JOIN "SaleReturn" r ON r.id = rl."saleReturnId"
      WHERE r."organizationId" = ${access.organizationId}
        AND ${access.storeIds.length ? Prisma.sql`r."storeId" IN (${Prisma.join(access.storeIds)})` : Prisma.sql`false`}
        AND r.status::text = 'COMPLETED'
        AND r."completedAt" >= ${range.fromUtc} AND r."completedAt" < ${range.toUtcExclusive}
    ` : Prisma.sql`SELECT NULL::text AS "productId", 0::numeric AS sold, 0::numeric AS returned,
      0::numeric AS revenue, 0::numeric AS refunds WHERE false`;
    const order = plan.productAction === "ranking"
      ? Prisma.sql`${plan.metric === "revenue" ? Prisma.sql`"netRevenueKgs"` : Prisma.sql`"netQuantity"`}
          ${plan.direction === "bottom" ? Prisma.sql`ASC` : Prisma.sql`DESC`}, name ASC, id ASC`
      : query ? Prisma.sql`CASE WHEN lower(sku) = lower(${query}) OR lower(name) = lower(${query})
          OR EXISTS (SELECT 1 FROM "ProductBarcode" pb WHERE pb."productId" = filtered.id
            AND pb."organizationId" = ${access.organizationId} AND lower(pb.value) = lower(${query}))
          THEN 0 ELSE 1 END, name ASC, id ASC`
        : Prisma.sql`name ASC, id ASC`;
    const rows = await tx.$queryRaw<ProductRow[]>(Prisma.sql`
      WITH population AS (SELECT p.* FROM "Product" p WHERE ${productScope}),
      activity AS (${activity}),
      grouped AS (SELECT "productId", SUM(sold) AS sold, SUM(returned) AS returned,
        SUM(revenue) - SUM(refunds) AS revenue FROM activity GROUP BY "productId"),
      filtered AS (
        SELECT p.id, p.name, p.sku, p.unit, p."basePriceKgs", COALESCE(p.categories[1], p.category) AS category,
          (SELECT pb.value FROM "ProductBarcode" pb WHERE pb."productId" = p.id
            AND pb."organizationId" = ${access.organizationId} ORDER BY pb."createdAt", pb.id LIMIT 1) AS barcode,
          COALESCE(g.sold, 0) AS "quantitySold", COALESCE(g.returned, 0) AS "quantityReturned",
          COALESCE(g.sold, 0) - COALESCE(g.returned, 0) AS "netQuantity", COALESCE(g.revenue, 0) AS "netRevenueKgs"
        FROM population p LEFT JOIN grouped g ON g."productId" = p.id
        WHERE true ${search}
          ${plan.productAction === "zero_sales" ? Prisma.sql`AND COALESCE(g.sold, 0) = 0` : Prisma.empty}
      )
      SELECT *, COUNT(*) OVER()::int AS total, (SELECT COUNT(*)::int FROM population) AS population
      FROM filtered ORDER BY ${order} LIMIT ${plan.limit}
    `);
    if (targetId && rows.length === 0) throw new AppError("productAccessDenied", "FORBIDDEN", 403);
    const number = (value: Prisma.Decimal | number) => new Intl.NumberFormat(input.locale === "kg" ? "ky-KG" : input.locale, { maximumFractionDigits: 2 }).format(Number(value));
    const cards = rows.map((row): BaamProductCard => ({
      id: row.id, title: row.name, href: `/products/${encodeURIComponent(row.id)}`, sku: row.sku || null,
      displayFields: dated ? [
        { label: c.netRevenue, value: `${number(row.netRevenueKgs)} KGS` },
        { label: c.netUnits, value: `${number(row.netQuantity)} ${row.unit}` },
        { label: c.sold, value: `${number(row.quantitySold)} ${row.unit}` },
        { label: c.returned, value: `${number(row.quantityReturned)} ${row.unit}` },
      ] : [
        { label: c.category, value: row.category || c.missing },
        { label: c.barcode, value: row.barcode || c.missing },
        { label: c.unit, value: row.unit },
        { label: c.price, value: row.basePriceKgs === null ? c.missing : `${number(row.basePriceKgs)} KGS` },
      ],
    }));
    // Do not infer a unique product merely because the requested limit is one.
    const total = rows[0]?.total ?? 0;
    const clarification = singleProduct && total > 1;
    evidence.details.push(`${c.matches}: ${total}; ${c.shown}: ${rows.length}${rows[0] ? `; ${c.count}: ${rows[0].population}` : ""}`);
    const heading = plan.productAction === "performance" ? c.performance : plan.productAction === "zero_sales" ? c.zero : dated ? c.ranking : c.catalog;
    const ordering = plan.productAction === "ranking" ? ` ${plan.direction === "bottom" ? c.bottom : c.top}: ${plan.metric === "revenue" ? c.netRevenue : c.netUnits}.` : "";
    return {
      status: clarification ? "clarification" : "answer",
      answer: `${heading}.${ordering} ${rows.length ? `${c.shown}: ${rows.length} / ${total}.` : c.noMatch}${clarification ? ` ${c.pick}` : ""}`,
      cards, evidence,
      ...((!dated || plan.productAction === "performance") && total === 1 ? { contextProductId: rows[0].id } : {}),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 });
};
