import { Prisma } from "@prisma/client";
import type { Context } from "@/server/trpc/trpc";
import { prisma } from "@/server/db/prisma";
import { baamRecordStatus } from "@/lib/baam/recordStatus";
import { baamText, baamUriComponent, type BaamLocale } from "@/lib/baam/companion";
import { buildAnalyticsReportHref } from "@/lib/analyticsReportLink";
import {
  listProductMovementJournal,
  getProductMovementDocument,
  type ProductMovementDocumentType,
} from "./productMovements";
import { baamAccess } from "./baamConversations";
import { getBaamSalesMetrics, readBaamAccessScope } from "./baamMetrics";
import { executeBaamProductPlan } from "./baamProducts";
import { baamReportPeriod } from "./baamPeriods";
import { resolveSalesAnalyticsDateRange } from "./salesAnalytics";
import { assertFeatureEnabled } from "./planLimits";
import { AppError } from "./errors";
import type { BaamReadRequest, BaamReadSection } from "./baamReadPlan";
import { baamSearch } from "./baamReadTools";
import { baamSpokenSkuKey } from "./baamSpokenSku";

export async function readBaamData(
  ctx: Context,
  request: BaamReadRequest,
  locale: BaamLocale,
  selectedStoreId?: string,
  pageProductId?: string,
): Promise<BaamReadSection> {
  const allAccessible = request.store === "*";
  const { scope } = await baamAccess(ctx, allAccessible ? undefined : selectedStoreId);
  const t = (ru: string, en: string, kg: string) => baamText(locale, ru, en, kg);
  const store =
    request.store && !allAccessible
      ? scope.availableStores.find(
          (s) =>
            s.id === request.store ||
            s.name.normalize("NFKC").toLowerCase() ===
              request.store!.normalize("NFKC").toLowerCase(),
        )
      : undefined;
  // Unknown store names never broaden a read to all stores.
  if (request.store && !allAccessible && !store)
    throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  const storeId = store?.id ?? (allAccessible ? undefined : selectedStoreId);
  const storeIds = storeId ? [storeId] : scope.storeIds;
  if (Boolean(request.dateFrom) !== Boolean(request.dateTo))
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  const explicitRange =
    request.dateFrom && request.dateTo
      ? { dateFrom: request.dateFrom, dateTo: request.dateTo }
      : undefined;
  const range = resolveSalesAnalyticsDateRange(explicitRange ?? baamReportPeriod("month"));
  const dated =
    Boolean(explicitRange) ||
    request.mode === "new" ||
    request.dataset === "sales_metrics" ||
    (request.dataset === "products" &&
      ["top", "bottom", "zero_sales", "details"].includes(request.mode));
  const window = { gte: range.fromUtc, lt: range.toUtcExclusive };
  const stores = scope.availableStores
    .filter((s) => storeIds.includes(s.id))
    .map((s) => s.name)
    .join(", ");
  const number = (v: unknown) =>
    new Intl.NumberFormat(locale === "kg" ? "ky-KG" : locale, { maximumFractionDigits: 2 }).format(
      Number(v),
    );
  const date = (v: Date) =>
    new Intl.DateTimeFormat(locale === "kg" ? "ky-KG" : locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bishkek",
    }).format(v);
  const section: BaamReadSection = {
    title: request.dataset,
    storeNames: scope.availableStores.filter((s) => storeIds.includes(s.id)).map((s) => s.name),
    periodLabel: dated
      ? new Intl.DateTimeFormat(locale === "kg" ? "ky-KG" : locale, {
          dateStyle: "medium",
          timeZone: "Asia/Bishkek",
        }).formatRange(
          new Date(range.dateFrom + "T12:00:00Z"),
          new Date(range.dateTo + "T12:00:00Z"),
        )
      : t("за всё время", "all dates", "бардык күндөр"),
    scope: `${stores} · ${dated ? `${range.dateFrom} — ${range.dateTo}` : t("все даты", "all dates", "бардык күндөр")} · Asia/Bishkek`,
    facts: [],
    records: [],
    notes: [],
    href: "/dashboard",
  };
  const fact = (label: string, value: unknown) =>
    section.facts.push({ label, value: String(value) });
  const totalLabel = t("Всего соответствует запросу", "Total matching", "Суроого дал келгендер");
  const shownLabel = t("Показано", "Shown", "Көрсөтүлдү");
  const feature = ["sales", "returns"].includes(request.dataset)
    ? "pos"
    : request.dataset === "orders"
      ? "customerOrders"
      : request.dataset === "stock_counts"
        ? "stockCounts"
        : undefined;
  if (feature) await assertFeatureEnabled({ organizationId: scope.organizationId, feature });

  if (request.dataset === "sales_metrics") {
    section.title = t("Продажи магазина", "Store sales", "Дүкөндүн сатуулары");
    section.href = buildAnalyticsReportHref({
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      storeId,
    });
    const metrics = await getBaamSalesMetrics({
      actorId: ctx.user!.id,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      storeId,
    });
    const labels = [
      t("Продажи до возвратов", "Sales before returns", "Кайтарууга чейинки сатуу"),
      t("Возвраты", "Returns", "Кайтаруулар"),
      t("Чистые продажи", "Net sales", "Таза сатуу"),
      t("Завершённые чеки", "Completed receipts", "Аяктаган чектер"),
      t("Средний чек", "Average receipt", "Орточо чек"),
      t("Скидки", "Discounts", "Арзандатуулар"),
    ];
    const values = (m: typeof metrics) => [
      m.totals.salesBeforeReturnsKgs,
      m.totals.returnsKgs,
      m.totals.netSalesKgs,
      m.totals.receiptCount,
      m.totals.averageReceiptKgs,
      m.totals.recordedDiscountKgs,
    ];
    values(metrics).forEach((v, i) =>
      fact(
        labels[i],
        v == null
          ? t("Нет завершённых чеков", "No completed receipts", "Аяктаган чек жок")
          : `${number(v)}${i === 3 ? "" : " KGS"}`,
      ),
    );
    for (const [method, value] of Object.entries(metrics.totals.paymentBreakdown))
      fact(`${t("Оплачено", "Paid", "Төлөндү")} · ${method}`, `${number(value)} KGS`);
    for (const [method, value] of Object.entries(metrics.totals.refundBreakdown))
      fact(
        `${t("Возмещено", "Refunded", "Кайтарылган төлөм")} · ${method}`,
        `${number(value)} KGS`,
      );
    if (request.mode === "comparison") {
      const days = Math.round(
        (range.toUtcExclusive.getTime() - range.fromUtc.getTime()) / 86400000,
      );
      const from = new Date(`${range.dateFrom}T00:00:00Z`),
        to = new Date(from);
      from.setUTCDate(from.getUTCDate() - days);
      to.setUTCDate(to.getUTCDate() - 1);
      const previous = await getBaamSalesMetrics({
        actorId: ctx.user!.id,
        dateFrom: from.toISOString().slice(0, 10),
        dateTo: to.toISOString().slice(0, 10),
        storeId,
      });
      fact(
        t("Предыдущий период", "Previous period", "Мурунку мезгил"),
        `${previous.period.dateFrom} — ${previous.period.dateTo}`,
      );
      values(previous).forEach((v, i) => {
        fact(
          `${labels[i]} · ${t("ранее", "previous", "мурда")}`,
          v == null ? "—" : `${number(v)}${i === 3 ? "" : " KGS"}`,
        );
        const current = values(metrics)[i];
        if (v != null && current != null) {
          fact(`${labels[i]} · Δ`, `${number(current - v)}${i === 3 ? "" : " KGS"}`);
          if (v !== 0) fact(`${labels[i]} · %`, `${number(((current - v) / Math.abs(v)) * 100)}%`);
        }
      });
    }
    if (request.mode === "daily")
      section.records = metrics.days.slice(0, request.limit).map((d) => ({
        id: d.date,
        title: d.date,
        sku: null,
        href: section.href,
        displayFields: [
          { label: labels[2], value: `${number(d.netSalesKgs)} KGS` },
          { label: labels[3], value: number(d.receiptCount) },
        ],
      }));
    section.notes.push(
      t(
        "Только завершённые неотложенные продажи кассы; возвраты по дате возврата. Это выручка, не прибыль. Причины изменений требуют проверки.",
        "Completed nonheld POS sales only; returns by their completion date. Revenue is not profit. Causes of changes require investigation.",
        "Кассанын аяктаган, кийинкиге калтырылбаган сатуулары гана; кайтаруулар өз датасы боюнча. Бул киреше, пайда эмес. Өзгөрүүнүн себептерин текшерүү керек.",
      ),
    );
    return section;
  }
  if (request.dataset === "products") {
    let productQuery = request.query;
    let resolvedProductId: string | undefined;
    if (productQuery && productQuery !== pageProductId) {
      const found = (await baamSearch(ctx, {
        kind: "products",
        query: productQuery,
        storeId,
        offset: 0,
      })) as { items: Array<{ id: string; name: string; sku: string }>; nextOffset: number | null };
      if (found.items.length === 1 && found.nextOffset === null) {
        resolvedProductId = found.items[0].id;
        productQuery = null;
      } else if (
        found.items.length > 1 &&
        (["details", "catalog_details"].includes(request.mode) || baamSpokenSkuKey(productQuery))
      ) {
        section.title = t("Выберите товар", "Choose the product", "Товарды тандаңыз");
        section.needsSelection = true;
        section.href = "/products";
        section.records = found.items.map((p) => ({
          id: p.id,
          title: p.name,
          sku: p.sku,
          href: "/products/" + p.id,
          displayFields: [],
        }));
        fact(shownLabel, number(found.items.length));
        section.notes.push(
          t(
            "Есть несколько подходящих товаров. Нужен точный артикул; не выбирайте товар наугад и не объединяйте их показатели.",
            "Several products match. Ask for the exact SKU; never guess a product or combine their figures.",
            "Бир нече товар дал келет. Так артикул керек; товарды божомолдобоңуз же көрсөткүчтөрүн кошпоңуз.",
          ),
        );
        return section;
      }
    }
    const productAction =
      request.mode === "zero_sales"
        ? "zero_sales"
        : ["top", "bottom"].includes(request.mode)
          ? "ranking"
          : request.mode === "catalog_details"
            ? "details"
            : request.mode === "details"
              ? "performance"
              : resolvedProductId
                ? "details"
                : "search";
    const result = await executeBaamProductPlan({
      actorId: ctx.user!.id,
      range: { dateFrom: range.dateFrom, dateTo: range.dateTo },
      storeId,
      locale,
      pageProductId: resolvedProductId ?? pageProductId,
      plan: {
        intent: "products",
        productAction,
        query:
          ["ranking", "zero_sales"].includes(productAction) || productQuery === pageProductId
            ? null
            : productQuery,
        direction:
          productAction === "ranking" ? (request.mode === "bottom" ? "bottom" : "top") : null,
        metric: productAction === "ranking" ? (request.metric ?? "revenue") : null,
        limit: request.limit,
      },
    });
    section.title = result.evidence.summary;
    section.needsSelection = result.status === "clarification";
    if (section.needsSelection)
      section.notes.push(
        t(
          "Для однозначного выбора товара нужно уточнение. Не объединяйте показатели разных совпадений.",
          "A product selection is required. Do not combine figures across ambiguous matches.",
          "Товарды так тандоо керек. Ар башка дал келүүлөрдүн көрсөткүчтөрүн кошпоңуз.",
        ),
      );
    if (["search", "details"].includes(productAction))
      section.periodLabel = t("текущий каталог", "current catalog", "учурдагы каталог");
    section.records = result.cards;
    const productCountLabel =
      request.mode === "bottom"
        ? t(
            "Всего товаров в базе рейтинга",
            "Total products in the ranking universe",
            "Рейтингдеги бардык товарлар",
          )
        : request.mode === "zero_sales"
          ? t(
              "Товаров без продаж за период",
              "Products without sales in the period",
              "Мезгилде сатылбаган товарлар",
            )
          : request.mode === "top"
            ? request.metric === "return_units"
              ? t("Товаров с возвратами", "Products with returns", "Кайтарылган товарлар")
              : t(
                  "Товаров с продажами за период",
                  "Products with sales in the period",
                  "Мезгилде сатылган товарлар",
                )
            : totalLabel;
    fact(productCountLabel, number(result.total ?? 0));
    fact(shownLabel, number(result.cards.length));
    fact(t("Запрошено товаров", "Requested products", "Суралган товарлар"), number(request.limit));
    if (result.population != null)
      fact(
        t(
          "Товаров в текущем каталоге",
          "Current catalog population",
          "Учурдагы каталогдогу товарлар",
        ),
        number(result.population),
      );
    section.records = result.cards.map((row) => ({
      ...row,
      displayFields:
        request.mode === "zero_sales"
          ? []
          : ["top", "bottom"].includes(request.mode) && request.metric !== "return_units"
            ? row.displayFields.slice(0, 2)
            : row.displayFields,
    }));
    section.notes = [result.answer, ...result.evidence.details];
    section.href = "/products";
    return section;
  }

  if (request.dataset === "stock_movements") {
    section.title =
      request.movementType === "RECEIVE"
        ? t("Оприходования", "Stock receipts", "Товар кабыл алуулар")
        : t("Движения запасов", "Stock movements", "Запастын кыймылдары");
    section.href = "/inventory/movements";
    const types: Array<ProductMovementDocumentType | undefined> =
      request.movementType === "RECEIVE"
        ? ["STOCK_RECEIVING", "RECEIVE", "PURCHASE_ORDER"]
        : request.movementType === "TRANSFER_IN" || request.movementType === "TRANSFER_OUT"
          ? ["TRANSFER"]
          : [request.movementType ?? undefined];
    const actor = { ...ctx.user!, role: scope.role, isOrgOwner: scope.isOrgOwner };
    const journals = [];
    for (const type of types)
      journals.push(
        await listProductMovementJournal(prisma, actor, {
          type,
          storeId,
          search: request.query,
          ...(dated ? { dateFrom: range.dateFrom, dateTo: range.dateTo } : {}),
          page: 1,
          pageSize: request.limit,
          sortBy: "date",
          sortDirection: "desc",
          archiveMode: "ACTIVE",
        }),
      );
    const documents = journals
      .flatMap((j) => j.items)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, request.mode === "latest" ? 1 : request.limit);
    fact(totalLabel, number(journals.reduce((n, j) => n + j.total, 0)));
    fact(shownLabel, number(documents.length));
    for (const row of documents) {
      const fields = [
        { label: t("Дата", "Date", "Дата"), value: date(row.postedAt ?? row.createdAt) },
        { label: t("Магазин", "Store", "Дүкөн"), value: row.storeName ?? stores },
        {
          label: t("Позиций в документе", "Document positions", "Документтеги позициялар"),
          value: number(row.positionsCount),
        },
        ...(row.totalAmount != null
          ? [
              {
                label: t("Сумма документа", "Document amount", "Документтин суммасы"),
                value: number(row.totalAmount) + " KGS",
              },
            ]
          : []),
      ];
      if (request.mode === "latest" || request.mode === "details") {
        const detail = await getProductMovementDocument(prisma, actor, row.id);
        for (const line of detail?.lines.slice(0, 50) ?? [])
          fields.push({
            label: line.productName + (line.sku ? " · " + line.sku : ""),
            value: number(line.qtyDelta) + " " + (line.unit ?? "") + " · " + line.storeName,
          });
      }
      section.records.push({
        id: row.id,
        title: row.documentLabel,
        sku: null,
        href: row.detailUrl ?? section.href,
        displayFields: fields,
      });
    }
    section.notes.push(
      t(
        "Каждая строка списка — документ, а не отдельная товарная позиция. Архивные документы исключены.",
        "Each list item is a document, not an individual product line. Archived documents are excluded.",
        "Тизмедеги ар бир сап өзүнчө документ, товар позициясы эмес. Архивдеги документтер камтылган эмес.",
      ),
    );
    return section;
  }

  let inventoryProductId: string | undefined;
  if (request.dataset === "inventory" && request.query && baamSpokenSkuKey(request.query)) {
    const found = (await baamSearch(ctx, {
      kind: "products",
      query: request.query,
      storeId,
      offset: 0,
    })) as { items: Array<{ id: string; name: string; sku: string }>; nextOffset: number | null };
    if (found.items.length === 1 && found.nextOffset === null)
      inventoryProductId = found.items[0].id;
    else if (found.items.length > 1 || found.nextOffset !== null) {
      section.title = t("Выберите товар", "Choose the product", "Товарды тандаңыз");
      section.needsSelection = true;
      section.href = "/products";
      section.records = found.items.map((p) => ({
        id: p.id,
        title: p.name,
        sku: p.sku,
        href: "/products/" + p.id,
        displayFields: [],
      }));
      section.notes.push(
        t(
          "Несколько товаров соответствуют произнесённому артикулу. Уточните артикул; не объединяйте остатки разных совпадений.",
          "Several products match the spoken SKU. Ask for the exact SKU; never combine their stock.",
          "Айтылган артикулга бир нече товар дал келет. Так артикулду сураңыз; калдыктарын кошпоңуз.",
        ),
      );
      return section;
    }
  }
  // Snapshot, store membership and operational rows are read in one transaction.
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const fresh = await readBaamAccessScope(tx, ctx.user!.id, storeId, false);
      if (fresh.authorizationFingerprint !== scope.authorizationFingerprint)
        throw new AppError("baamScopeChanged", "CONFLICT", 409);
      const storeFilter = { in: storeIds };
      const contains = { contains: request.query ?? "", mode: "insensitive" as const };
      const take = request.mode === "latest" ? 1 : request.limit;
      const page = { take, orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }] };
      const created = dated ? { createdAt: window } : {};
      const createdField = t("Создано", "Created", "Түзүлдү");
      const storeField = t("Магазин", "Store", "Дүкөн");
      const storeName = (id: string) => scope.availableStores.find((s) => s.id === id)?.name ?? "";
      const fields = (row: { createdAt: Date; storeId?: string }) => [
        { label: createdField, value: date(row.createdAt) },
        ...(row.storeId ? [{ label: storeField, value: storeName(row.storeId) }] : []),
      ];
      if (request.dataset === "customers" || request.dataset === "suppliers") {
        section.title =
          request.dataset === "customers"
            ? t("Клиенты", "Customers", "Кардарлар")
            : t("Поставщики", "Suppliers", "Жеткирүүчүлөр");
        section.href = request.dataset === "customers" ? "/customers" : "/suppliers";
        const where = {
          organizationId: scope.organizationId,
          ...created,
          OR: [
            { id: request.query ?? "" },
            { name: contains },
            { phone: contains },
            { email: contains },
          ],
          ...(request.dataset === "customers" ? { storeId: storeFilter, deletedAt: null } : {}),
        };
        const rows =
          request.dataset === "customers"
            ? await tx.customer.findMany({
                where,
                ...page,
                select: {
                  id: true,
                  name: true,
                  createdAt: true,
                  storeId: true,
                  phone: true,
                  email: true,
                  orderCount: true,
                  lastOrderAt: true,
                },
              })
            : await tx.supplier.findMany({
                where,
                ...page,
                select: { id: true, name: true, createdAt: true, phone: true, email: true },
              });
        const total =
          request.dataset === "customers"
            ? await tx.customer.count({ where })
            : await tx.supplier.count({ where });
        fact(totalLabel, number(total));
        fact(shownLabel, number(rows.length));
        section.records = rows.map((row) => ({
          id: row.id,
          title: row.name,
          sku: null,
          href:
            "storeId" in row
              ? `/customers?customerId=${row.id}&storeId=${row.storeId}`
              : `/suppliers?q=${baamUriComponent(row.name)}`,
          displayFields: [
            ...fields(row),
            ...(row.phone && request.mode === "details"
              ? [{ label: t("Телефон", "Phone", "Телефон"), value: row.phone }]
              : []),
            ...(row.email && request.mode === "details"
              ? [{ label: t("Электронная почта", "Email", "Электрондук почта"), value: row.email }]
              : []),
          ],
        }));
      } else if (request.dataset === "sales" || request.dataset === "orders") {
        const sale = request.dataset === "sales";
        section.title = sale
          ? t("Завершённые продажи кассы", "Completed POS sales", "Кассанын аяктаган сатуулары")
          : t("Заказы клиентов", "Customer orders", "Кардарлардын буйрутмалары");
        if (sale && request.mode === "details")
          section.title = t("Кассовые чеки", "POS receipts", "Кассанын чектери");
        section.href = sale ? "/pos/history" : "/sales/orders";
        const draft = request.mode === "drafts";
        if (draft)
          section.title = t(
            "Черновики и отложенные чеки",
            "Drafts and held receipts",
            "Долбоорлор жана кийинкиге калтырылган чектер",
          );
        const canonical = /^(S|SO)[\s-]*(\d{1,12})$/i.exec(request.query ?? "");
        const where: Prisma.CustomerOrderWhereInput = {
          organizationId: scope.organizationId,
          storeId: storeFilter,
          isPosSale: sale,
          ...(sale && !draft && request.mode !== "details"
            ? { status: "COMPLETED", isHeld: false, ...(dated ? { completedAt: window } : {}) }
            : { ...(draft ? { status: "DRAFT" } : {}), ...created }),
          OR: [
            { id: request.query ?? "" },
            { number: contains },
            { customerName: contains },
            ...(canonical
              ? [
                  {
                    number: `${canonical[1].toUpperCase()}-${String(Number(canonical[2])).padStart(6, "0")}`,
                  },
                ]
              : []),
          ],
        };
        const rows = await tx.customerOrder.findMany({
          where,
          take,
          orderBy: sale && !draft ? [{ completedAt: "desc" }, { id: "desc" }] : page.orderBy,
          select: {
            id: true,
            number: true,
            storeId: true,
            status: true,
            createdAt: true,
            completedAt: true,
            totalKgs: true,
            customerName: true,
            isHeld: true,
            lines: {
              select: {
                qty: true,
                lineTotalKgs: true,
                product: { select: { name: true, sku: true } },
              },
              take: 50,
            },
          },
        });
        fact(totalLabel, number(await tx.customerOrder.count({ where })));
        fact(shownLabel, number(rows.length));
        if (["list", "drafts"].includes(request.mode)) {
          const totals = await tx.customerOrder.aggregate({ where, _sum: { totalKgs: true } });
          fact(
            t(
              "Общая сумма ВСЕХ соответствующих документов",
              "TOTAL amount of ALL matching documents",
              "Дал келген БАРДЫК документтердин ЖАЛПЫ суммасы",
            ),
            `${number(totals._sum.totalKgs ?? 0)} KGS`,
          );
        }
        section.records = rows.map((row) => ({
          id: row.id,
          title: row.number,
          sku: null,
          href: sale ? `/pos/history?saleId=${row.id}` : `/sales/orders/${row.id}`,
          displayFields: [
            {
              label: t("Сумма этого чека", "This receipt's amount", "Бул чектин суммасы"),
              value: `${number(row.totalKgs)} KGS`,
            },
            {
              label: t("Статус", "Status", "Абал"),
              value: draft
                ? t("Не оплачен · черновик", "Unpaid · draft", "Төлөнгөн эмес · долбоор")
                : row.status === "COMPLETED"
                  ? t("Завершён", "Completed", "Аяктады")
                  : baamRecordStatus(row.status, locale),
            },
            {
              label: row.completedAt ? t("Завершено", "Completed at", "Аяктады") : createdField,
              value: date(row.completedAt ?? row.createdAt),
            },
            { label: storeField, value: storeName(row.storeId) },
            ...(row.customerName
              ? [{ label: t("Клиент", "Customer", "Кардар"), value: row.customerName }]
              : []),
            ...(["latest", "details"].includes(request.mode)
              ? row.lines.map((l) => ({
                  label: `${l.product.name} · ${l.product.sku}`,
                  value: `${number(l.qty)} · ${number(l.lineTotalKgs)} KGS`,
                }))
              : []),
          ],
        }));
      } else if (request.dataset === "inventory") {
        section.title =
          request.mode === "low_stock"
            ? t("Товары с низким остатком", "Low-stock items", "Калдыгы аз товарлар")
            : request.mode === "negative_stock"
              ? t("Отрицательные остатки", "Negative stock", "Терс калдыктар")
              : request.mode === "empty_stock"
                ? t("Нулевые остатки", "Zero stock", "Нөл калдыктар")
                : t("Текущие остатки", "Current stock", "Учурдагы калдыктар");
        section.periodLabel = t("сейчас", "now", "азыр");
        section.href = "/inventory";
        section.scope = `${stores} · ${t("на момент запроса", "at query time", "суроо учурунда")}`;
        const threshold = request.stockThreshold ?? 5;
        const where: Prisma.InventorySnapshotWhereInput = {
          store: { organizationId: scope.organizationId, id: storeFilter },
          product: {
            organizationId: scope.organizationId,
            isDeleted: false,
            ...(inventoryProductId
              ? { id: inventoryProductId }
              : { OR: [{ id: request.query ?? "" }, { name: contains }, { sku: contains }] }),
          },
          ...(request.mode === "negative_stock"
            ? { onHand: { lt: 0 } }
            : request.mode === "empty_stock"
              ? { onHand: 0 }
              : request.mode === "low_stock"
                ? { onHand: { lte: threshold } }
                : {}),
        };
        const rows = await tx.inventorySnapshot.findMany({
          where,
          take,
          orderBy: [{ onHand: "asc" }, { id: "asc" }],
          select: {
            id: true,
            onHand: true,
            onOrder: true,
            storeId: true,
            product: { select: { id: true, name: true, sku: true, unit: true } },
            variant: { select: { name: true } },
          },
        });
        fact(totalLabel, number(await tx.inventorySnapshot.count({ where })));
        fact(
          t(
            "Из них с отрицательным остатком",
            "Matching rows with negative stock",
            "Анын ичинде терс калдыгы бар",
          ),
          number(
            await tx.inventorySnapshot.count({ where: { AND: [where, { onHand: { lt: 0 } }] } }),
          ),
        );
        fact(
          t("Из них с нулевым остатком", "Matching rows with zero stock", "Анын ичинде нөл калдык"),
          number(await tx.inventorySnapshot.count({ where: { AND: [where, { onHand: 0 }] } })),
        );
        fact(shownLabel, number(rows.length));
        if (request.mode === "low_stock")
          fact(
            t(
              "Порог включительно, в базовой единице товара",
              "Inclusive threshold in each product's base unit",
              "Чек, товардын негизги бирдигинде",
            ),
            number(threshold),
          );
        section.records = rows.map((row) => ({
          id: row.id,
          title: `${row.product.name}${row.variant ? ` · ${row.variant.name}` : ""}`,
          sku: row.product.sku,
          href: `/products/${row.product.id}`,
          displayFields: [
            {
              label: t("На руках", "On hand", "Колдо"),
              value: `${number(row.onHand)} ${row.product.unit}`,
            },
            { label: storeField, value: storeName(row.storeId) },
            {
              label: t("В заказах поставщику", "On order", "Буйрутмада"),
              value: `${number(row.onOrder)} ${row.product.unit}`,
            },
          ],
        }));
        section.notes.push(
          t(
            "Текущий снимок остатков, не исторический. Строки вариантов учитываются отдельно. Низкий остаток — выбранный порог, не рассчитанный прогноз закупки.",
            "Current stock snapshot, not historical. Variants are separate rows. Low stock uses the stated threshold, not a purchasing forecast.",
            "Бул тарыхый эмес, учурдагы калдык. Варианттар өзүнчө саптар. Аз калдык көрсөтүлгөн чек менен тандалат, сатып алуу божомолу эмес.",
          ),
        );
      } else if (request.dataset === "stores") {
        section.title = t("Доступные магазины", "Accessible stores", "Жеткиликтүү дүкөндөр");
        section.periodLabel = t("сейчас", "now", "азыр");
        section.href = "/stores";
        const rows = scope.availableStores.filter(
          (s) =>
            storeIds.includes(s.id) &&
            (!request.query || s.name.toLowerCase().includes(request.query.toLowerCase())),
        );
        fact(totalLabel, number(rows.length));
        section.records = rows.slice(0, take).map((row) => ({
          id: row.id,
          title: row.name,
          sku: null,
          href: "/stores",
          displayFields: [],
        }));
      } else if (request.dataset === "purchases") {
        section.title = t("Заказы поставщикам", "Purchase orders", "Жеткирүүчүгө буйрутмалар");
        section.href = "/purchase-orders";
        const where: Prisma.PurchaseOrderWhereInput = {
          organizationId: scope.organizationId,
          storeId: storeFilter,
          ...created,
          ...(request.query ? { supplier: { name: contains } } : {}),
          ...(request.mode === "drafts" ? { status: "DRAFT" } : {}),
        };
        const rows = await tx.purchaseOrder.findMany({
          where,
          ...page,
          select: {
            id: true,
            status: true,
            createdAt: true,
            storeId: true,
            supplier: { select: { name: true } },
          },
        });
        fact(totalLabel, number(await tx.purchaseOrder.count({ where })));
        fact(shownLabel, number(rows.length));
        section.records = rows.map((row) => ({
          id: row.id,
          title: row.supplier?.name ?? section.title,
          sku: null,
          href: `/purchase-orders/${row.id}`,
          displayFields: [
            ...fields(row),
            { label: t("Статус", "Status", "Абал"), value: row.status },
          ],
        }));
      } else if (request.dataset === "stock_counts") {
        section.title = t("Инвентаризации", "Stock counts", "Инвентаризациялар");
        section.href = "/inventory/counts";
        const where: Prisma.StockCountWhereInput = {
          organizationId: scope.organizationId,
          storeId: storeFilter,
          code: contains,
          ...created,
          ...(request.mode === "drafts" ? { status: "DRAFT" } : {}),
        };
        const rows = await tx.stockCount.findMany({
          where,
          ...page,
          select: { id: true, code: true, status: true, createdAt: true, storeId: true },
        });
        fact(totalLabel, number(await tx.stockCount.count({ where })));
        fact(shownLabel, number(rows.length));
        section.records = rows.map((row) => ({
          id: row.id,
          title: row.code,
          sku: null,
          href: `/inventory/counts/${row.id}`,
          displayFields: [
            ...fields(row),
            { label: t("Статус", "Status", "Абал"), value: row.status },
          ],
        }));
      } else if (request.dataset === "returns") {
        section.title = t("Завершённые возвраты", "Completed returns", "Аяктаган кайтаруулар");
        section.href = "/pos/history";
        const where: Prisma.SaleReturnWhereInput = {
          organizationId: scope.organizationId,
          storeId: storeFilter,
          number: contains,
          status: "COMPLETED",
          ...(dated ? { completedAt: window } : {}),
        };
        const rows = await tx.saleReturn.findMany({
          where,
          take,
          orderBy: [{ completedAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            number: true,
            originalSaleId: true,
            totalKgs: true,
            completedAt: true,
            createdAt: true,
            storeId: true,
          },
        });
        fact(totalLabel, number(await tx.saleReturn.count({ where })));
        fact(shownLabel, number(rows.length));
        section.records = rows.map((row) => ({
          id: row.id,
          title: row.number,
          sku: null,
          href: `/pos/history?saleId=${row.originalSaleId}`,
          displayFields: [
            { label: t("Сумма", "Amount", "Сумма"), value: `${number(row.totalKgs)} KGS` },
            ...fields({ ...row, createdAt: row.completedAt ?? row.createdAt }),
          ],
        }));
      }
      return section;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
  );
}
