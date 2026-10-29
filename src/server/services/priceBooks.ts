import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  Prisma,
  type PriceBookStoreItem,
  type StorePrice,
  type StorePriceTypes,
} from "@prisma/client";
import type { PriceBookChangeInput } from "@/lib/priceBookContract";
import { prisma } from "@/server/db/prisma";
import { decodePriceBookSnapshot, encodePriceBookSnapshot } from "./priceBookSnapshot";
import { AppError } from "./errors";
import { withIdempotency } from "./idempotency";
import { writeAuditLog } from "./audit";
import { toJson } from "./json";
import { assertUserCanAccessStore, type StoreAccessUser } from "./storeAccess";
import { assertFeatureEnabled } from "./planLimits";
import { eventBus } from "@/server/events/eventBus";
import { invalidateBazaarCatalogCacheForStore } from "./bazaarCatalog";
import { invalidateBazaarApiProductsCacheForStore } from "./bazaarApi";
import { getLogger } from "@/server/logging";

type Tx = Prisma.TransactionClient;
type Request = { user: StoreAccessUser; bookId: string; change: PriceBookChangeInput };
type Scope = { productIds: string[]; storeIds: string[] };
const sorted = (values: string[]) => [...new Set(values)].sort();
const key = (productId: string, variantKey: string) => `${productId}:${variantKey}`;
const itemKey = (r: { storeId: string; productId: string; variantKey: string }) =>
  `${r.storeId}:${key(r.productId, r.variantKey)}`;
const hash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
const stale = () => new AppError("priceBookPreviewStale", "CONFLICT", 409);
const invalid = () => new AppError("priceBookScopeMismatch", "BAD_REQUEST", 400);
const secret = () => {
  if (!process.env.NEXTAUTH_SECRET)
    throw new AppError("serviceUnavailable", "INTERNAL_SERVER_ERROR", 503);
  return process.env.NEXTAUTH_SECRET;
};

async function authorize(user: StoreAccessUser) {
  const actor = await prisma.user.findFirst({
    where: { id: user.id, organizationId: user.organizationId },
    select: { role: true, isOrgOwner: true, isActive: true },
  });
  if (!actor?.isActive || (actor.role !== "ADMIN" && !actor.isOrgOwner))
    throw new AppError("forbidden", "FORBIDDEN", 403);
  await assertFeatureEnabled({ organizationId: user.organizationId, feature: "storePrices" });
}

export async function createPriceBook(input: {
  user: StoreAccessUser;
  name: string;
  requestId: string;
}) {
  await authorize(input.user);
  return prisma.$transaction(async (tx) => {
    const book = await tx.priceBook.create({
      data: { organizationId: input.user.organizationId, name: input.name.trim() },
    });
    await writeAuditLog(tx, {
      organizationId: book.organizationId,
      actorId: input.user.id,
      action: "PRICE_BOOK_CREATE",
      entity: "PriceBook",
      entityId: book.id,
      after: toJson({ name: book.name, currencyCode: book.currencyCode }),
      requestId: input.requestId,
    });
    return book;
  });
}

type PriceRow = Omit<
  StorePrice,
  | "priceKgs"
  | "retailPriceKgs"
  | "wholesalePriceKgs"
  | "discountPercentage"
  | "discountStartsAt"
  | "discountEndsAt"
  | "discountUpdatedAt"
  | "updatedAt"
> & {
  priceKgs: string;
  retailPriceKgs: string | null;
  wholesalePriceKgs: string | null;
  discountPercentage: string | null;
  discountStartsAt: string | null;
  discountEndsAt: string | null;
  discountUpdatedAt: string | null;
  updatedAt: string;
};
type TypeRow = Omit<StorePriceTypes, "retailPriceKgs" | "wholesalePriceKgs" | "updatedAt"> & {
  retailPriceKgs: string | null;
  wholesalePriceKgs: string | null;
  updatedAt: string;
};
const scopeSql = (org: string, scope: Scope) =>
  Prisma.sql`"organizationId"=${org} AND "storeId"=ANY(${scope.storeIds}::text[]) AND "productId"=ANY(${scope.productIds}::text[])`;
const decimalText = (column: string) =>
  Prisma.sql`trim(trailing '.' from trim(trailing '0' from ${Prisma.raw(`"${column}"`)}::text))`;
const dateText = (column: string) =>
  Prisma.sql`to_char(${Prisma.raw(`"${column}"`)}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
async function priceRowDigest(
  tx: Tx,
  org: string,
  bookId: string,
  scope: Scope,
  table: "StorePrice" | "StorePriceTypes" | "PriceBookStoreItem",
) {
  const rows = await tx.$queryRaw<Array<{ value: string }>>(Prisma.sql`
    SELECT encode(sha256(convert_to(COALESCE(string_agg(encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'), '' ORDER BY r."storeId",r."productId",r."variantKey"),''),'UTF8')),'hex') AS value
    FROM (SELECT * FROM ${Prisma.raw(`"${table}"`)} WHERE ${scopeSql(org, scope)} ${table === "PriceBookStoreItem" ? Prisma.sql`AND "bookId"=${bookId}` : Prisma.empty}) r`);
  return rows[0].value;
}
async function loadState(
  tx: Tx,
  organizationId: string,
  bookId: string,
  requested?: Scope,
  includeRows = true,
) {
  const book = await tx.priceBook.findFirst({ where: { id: bookId, organizationId } });
  if (!book) throw new AppError("recordNotFound", "NOT_FOUND", 404);
  const [entries, bindings] = await Promise.all([
    tx.priceBookEntry.findMany({
      where: { organizationId, bookId },
      orderBy: [{ productId: "asc" }, { variantKey: "asc" }],
    }),
    tx.priceBookStore.findMany({ where: { organizationId, bookId }, orderBy: { storeId: "asc" } }),
  ]);
  const scope = {
    productIds: sorted(requested?.productIds ?? entries.map((e) => e.productId)),
    storeIds: sorted(requested?.storeIds ?? bindings.map((b) => b.storeId)),
  };
  if (entries.length > 10_000 || scope.productIds.length * scope.storeIds.length > 100_000)
    throw new AppError("priceBookScopeTooLarge", "BAD_REQUEST", 400);
  const [stores, products, prices, types, items, rowDigest] = await Promise.all([
    tx.store.findMany({
      where: { organizationId, id: { in: scope.storeIds } },
      select: { id: true, name: true, currencyCode: true, currencyRateKgsPerUnit: true },
      orderBy: { id: "asc" },
    }),
    tx.product.findMany({
      where: { organizationId, id: { in: scope.productIds } },
      select: {
        id: true,
        name: true,
        sku: true,
        baseUnitId: true,
        isDeleted: true,
        variants: {
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { id: "asc" },
        },
      },
      orderBy: { id: "asc" },
    }),
    includeRows
      ? tx.$queryRaw<PriceRow[]>(Prisma.sql`
      SELECT id,"organizationId","storeId","productId","variantId","variantKey",
        ${decimalText("retailPriceKgs")} AS "retailPriceKgs",${decimalText("wholesalePriceKgs")} AS "wholesalePriceKgs",${decimalText("priceKgs")} AS "priceKgs",
        "discountType",${decimalText("discountPercentage")} AS "discountPercentage",${dateText("discountStartsAt")} AS "discountStartsAt",${dateText("discountEndsAt")} AS "discountEndsAt",
        "discountCreatedById",${dateText("discountUpdatedAt")} AS "discountUpdatedAt",${dateText("updatedAt")} AS "updatedAt","updatedById"
      FROM "StorePrice" WHERE ${scopeSql(organizationId, scope)} ORDER BY "storeId","productId","variantKey"`)
      : [],
    includeRows
      ? tx.$queryRaw<TypeRow[]>(Prisma.sql`
      SELECT id,"organizationId","storeId","productId","variantId","variantKey",${decimalText("retailPriceKgs")} AS "retailPriceKgs",${decimalText("wholesalePriceKgs")} AS "wholesalePriceKgs",${dateText("updatedAt")} AS "updatedAt","updatedById"
      FROM "StorePriceTypes" WHERE ${scopeSql(organizationId, scope)} ORDER BY "storeId","productId","variantKey"`)
      : [],
    includeRows
      ? tx.priceBookStoreItem.findMany({
          where: {
            organizationId,
            bookId,
            storeId: { in: scope.storeIds },
            productId: { in: scope.productIds },
          },
          orderBy: [{ storeId: "asc" }, { productId: "asc" }, { variantKey: "asc" }],
        })
      : [],
    Promise.all([
      priceRowDigest(tx, organizationId, bookId, scope, "StorePrice"),
      priceRowDigest(tx, organizationId, bookId, scope, "StorePriceTypes"),
      priceRowDigest(tx, organizationId, bookId, scope, "PriceBookStoreItem"),
    ]),
  ]);
  if (stores.length !== scope.storeIds.length || products.length !== scope.productIds.length)
    throw invalid();
  // Names are presentation, not price concurrency. Product units and store currencies are authoritative.
  return {
    book: { id: book.id, version: book.version },
    scope,
    entries,
    bindings,
    stores,
    products,
    prices,
    types,
    items,
    rowDigest,
  };
}
type State = Awaited<ReturnType<typeof loadState>>;
const digest = (s: State) => {
  return hash({
    book: s.book,
    scope: s.scope,
    entries: s.entries,
    bindings: s.bindings,
    rowDigest: s.rowDigest,
    stores: s.stores.map(({ name: _n, ...r }) => r),
    products: s.products.map(({ name: _n, sku: _s, variants, ...r }) => ({
      ...r,
      variants: variants.map((v) => v.id),
    })),
  });
};

async function requestedScope(tx: Tx, input: Request): Promise<Scope> {
  const c = input.change;
  if (c.kind === "ROLLBACK") {
    const previous = await tx.priceBookChange.findFirst({
      where: { id: c.changeId, organizationId: input.user.organizationId, bookId: input.bookId },
    });
    if (!previous || previous.kind === "ROLLBACK") throw invalid();
    return previous.scope as Scope;
  }
  if (c.kind === "PRICES" || c.kind === "REMOVE")
    return {
      productIds: c.entries.map((e) => e.productId),
      storeIds: (
        await tx.priceBookStore.findMany({
          where: { organizationId: input.user.organizationId, bookId: input.bookId },
          select: { storeId: true },
        })
      ).map((s) => s.storeId),
    };
  return {
    productIds:
      c.kind === "SOURCE"
        ? [c.productId]
        : (
            await tx.priceBookEntry.findMany({
              where: { organizationId: input.user.organizationId, bookId: input.bookId },
              select: { productId: true },
            })
          ).map((p) => p.productId),
    storeIds: c.storeIds,
  };
}

type Plan = {
  entries: State["entries"];
  bindings: State["bindings"];
  items: State["items"];
  writes: Array<{
    storeId: string;
    productId: string;
    variantKey: string;
    retail: string | null;
    wholesale: string | null;
  }>;
  restore?: State;
  summary: ReturnType<typeof summarize>;
};
function summarize(state: State, writes: Plan["writes"], preserved: number, kind: string) {
  const standard = new Map(state.prices.map((p) => [itemKey(p), p]));
  const extras = new Map(state.types.map((p) => [itemKey(p), p]));
  const changed = writes.filter((w) => {
    const sp = standard.get(itemKey(w)),
      ex = extras.get(itemKey(w));
    return (
      (w.retail !== null &&
        (sp?.priceKgs?.toString() !== w.retail || ex?.retailPriceKgs?.toString() !== w.retail)) ||
      (w.wholesale !== null && ex?.wholesalePriceKgs?.toString() !== w.wholesale)
    );
  });
  return {
    ...listChanges(state, state.entries),
    kind,
    changedPositions: changed.length,
    preservedKinds: preserved,
    currencyCode: "KGS",
    stores: state.stores.map((store) => ({
      id: store.id,
      name: store.name,
      changedPositions: changed.filter((w) => w.storeId === store.id).length,
    })),
    sample: changed.slice(0, 30).map((w) => ({
      ...w,
      name: state.products.find((p) => p.id === w.productId)?.name ?? w.productId,
      beforeRetail:
        (
          extras.get(itemKey(w))?.retailPriceKgs ?? standard.get(itemKey(w))?.priceKgs
        )?.toString() ?? null,
      beforeWholesale: extras.get(itemKey(w))?.wholesalePriceKgs?.toString() ?? null,
    })),
    openDocumentsPreserved: true,
  };
}

function listChanges(state: State, next: State["entries"]) {
  const before = new Map(state.entries.map((e) => [key(e.productId, e.variantKey), e]));
  const after = new Map(next.map((e) => [key(e.productId, e.variantKey), e]));
  const changes = [...new Set([...before.keys(), ...after.keys()])].filter((k) => {
    const a = before.get(k),
      b = after.get(k);
    return (
      a?.retailPriceKgs.toString() !== b?.retailPriceKgs.toString() ||
      a?.wholesalePriceKgs?.toString() !== b?.wholesalePriceKgs?.toString()
    );
  });
  return {
    listChangedPositions: changes.length,
    listSample: changes.slice(0, 30).map((k) => {
      const a = before.get(k),
        b = after.get(k),
        e = b ?? a!;
      return {
        productId: e.productId,
        variantKey: e.variantKey,
        name: state.products.find((p) => p.id === e.productId)?.name ?? e.productId,
        beforeRetail: a?.retailPriceKgs.toString() ?? null,
        beforeWholesale: a?.wholesalePriceKgs?.toString() ?? null,
        retail: b?.retailPriceKgs.toString() ?? null,
        wholesale: b?.wholesalePriceKgs?.toString() ?? null,
      };
    }),
  };
}

async function plan(tx: Tx, input: Request, state: State): Promise<Plan> {
  const c = input.change,
    org = input.user.organizationId;
  if (c.kind === "ROLLBACK") {
    const previous = await tx.priceBookChange.findFirst({
      where: { id: c.changeId, organizationId: org, bookId: input.bookId },
    });
    if (
      !previous ||
      previous.version !== state.book.version ||
      previous.afterHash !== digest(state)
    )
      throw new AppError("priceBookRollbackConflict", "CONFLICT", 409);
    const format = (previous.before as { format?: string }).format ?? "gzip-json-v1";
    const restore: State = previous.snapshot
      ? await decodePriceBookSnapshot<State>(previous.snapshot, format)
      : (previous.before as unknown as State);
    if (
      restore.book.id !== input.bookId ||
      hash(sorted(restore.scope.productIds)) !==
        hash(sorted((previous.scope as Scope).productIds)) ||
      hash(sorted(restore.scope.storeIds)) !== hash(sorted((previous.scope as Scope).storeIds))
    )
      throw invalid();
    const original = previous.summary as ReturnType<typeof summarize>;
    const restoredSummary = {
      ...summarize(state, [], 0, c.kind),
      ...listChanges(state, restore.entries),
      changedPositions: original.changedPositions,
      stores: original.stores,
      sample: original.sample.map((row) => ({
        ...row,
        beforeRetail: row.retail ?? row.beforeRetail,
        beforeWholesale: row.wholesale ?? row.beforeWholesale,
        retail: row.beforeRetail,
        wholesale: row.beforeWholesale,
      })),
    };
    return {
      entries: restore.entries,
      bindings: restore.bindings,
      items: restore.items,
      writes: [],
      restore,
      summary: restoredSummary,
    };
  }
  const entries = new Map(state.entries.map((e) => [key(e.productId, e.variantKey), e]));
  let bindings = [...state.bindings];
  if (c.kind === "PRICES") {
    if (c.expectedVersion !== undefined && c.expectedVersion !== state.book.version) throw stale();
    if (
      new Set(c.entries.map((e) => key(e.productId, e.variantId ?? "BASE"))).size !==
      c.entries.length
    )
      throw invalid();
    for (const e of c.entries) {
      const p = state.products.find((p) => p.id === e.productId),
        variantKey = e.variantId ?? "BASE";
      if (!p || p.isDeleted || (e.variantId && !p.variants.some((v) => v.id === e.variantId)))
        throw invalid();
      const old = entries.get(key(e.productId, variantKey));
      if (old && old.baseUnitId !== p.baseUnitId)
        throw new AppError("priceBookUnitConflict", "CONFLICT", 409);
      entries.set(key(e.productId, variantKey), {
        id: old?.id ?? randomUUID(),
        organizationId: org,
        bookId: input.bookId,
        productId: e.productId,
        variantKey,
        baseUnitId: p.baseUnitId,
        retailPriceKgs: new Prisma.Decimal(e.retailPriceKgs),
        wholesalePriceKgs:
          e.wholesalePriceKgs === null ? null : new Prisma.Decimal(e.wholesalePriceKgs),
      });
    }
  }
  if (c.kind === "REMOVE") {
    for (const e of c.entries) {
      if (!entries.delete(key(e.productId, e.variantId ?? "BASE"))) throw invalid();
    }
  }
  if (entries.size > 10_000) throw new AppError("priceBookScopeTooLarge", "BAD_REQUEST", 400);
  if (c.kind === "CONNECT") {
    const other = await tx.priceBookStore.count({
      where: { storeId: { in: c.storeIds }, NOT: { bookId: input.bookId } },
    });
    if (other || c.storeIds.some((id) => bindings.some((b) => b.storeId === id)))
      throw new AppError("priceBookAlreadyConnected", "CONFLICT", 409);
    bindings.push(
      ...sorted(c.storeIds).map((storeId) => ({
        id: randomUUID(),
        organizationId: org,
        bookId: input.bookId,
        storeId,
        preserveLocal: c.preserveLocal,
      })),
    );
  }
  if (c.kind === "DISCONNECT") {
    if (c.storeIds.some((id) => !bindings.some((b) => b.storeId === id))) throw invalid();
    bindings = bindings.filter((b) => !c.storeIds.includes(b.storeId));
  }
  const items = new Map(
    state.items
      .filter(
        (i) =>
          bindings.some((b) => b.storeId === i.storeId) &&
          entries.has(key(i.productId, i.variantKey)),
      )
      .map((i) => [itemKey(i), i]),
  );
  const prices = new Map(state.prices.map((p) => [itemKey(p), p])),
    types = new Map(state.types.map((p) => [itemKey(p), p]));
  const edited =
    c.kind === "PRICES"
      ? new Set(c.entries.map((e) => key(e.productId, e.variantId ?? "BASE")))
      : null;
  const writes: Plan["writes"] = [];
  let preserved = 0;
  if (
    c.kind === "SOURCE" &&
    (!entries.has(key(c.productId, c.variantId ?? "BASE")) ||
      c.storeIds.some((id) => !bindings.some((b) => b.storeId === id)))
  )
    throw invalid();
  for (const binding of bindings) {
    for (const e of entries.values()) {
      if (c.kind === "PRICES" && !edited?.has(key(e.productId, e.variantKey))) continue;
      if (c.kind === "CONNECT" && !c.storeIds.includes(binding.storeId)) continue;
      if (c.kind === "DISCONNECT" || c.kind === "REMOVE") continue;
      if (
        c.kind === "SOURCE" &&
        (c.productId !== e.productId ||
          (c.variantId ?? "BASE") !== e.variantKey ||
          !c.storeIds.includes(binding.storeId))
      )
        continue;
      const identity = {
          storeId: binding.storeId,
          productId: e.productId,
          variantKey: e.variantKey,
        },
        ik = itemKey(identity);
      const p = prices.get(ik),
        extra = types.get(ik),
        oldItem = items.get(ik);
      const item: PriceBookStoreItem = oldItem
        ? { ...oldItem }
        : {
            id: randomUUID(),
            organizationId: org,
            bookId: input.bookId,
            ...identity,
            retailShared: !binding.preserveLocal || (p == null && extra?.retailPriceKgs == null),
            wholesaleShared:
              e.wholesalePriceKgs != null &&
              (!binding.preserveLocal || extra?.wholesalePriceKgs == null),
          };
      if (c.kind === "SOURCE") {
        if (c.wholesaleShared && e.wholesalePriceKgs == null) throw invalid();
        item.retailShared = c.retailShared;
        item.wholesaleShared = c.wholesaleShared;
      }
      if (e.wholesalePriceKgs == null) item.wholesaleShared = false;
      items.set(ik, item);
      const retail = item.retailShared ? e.retailPriceKgs.toString() : null;
      const wholesale =
        item.wholesaleShared && e.wholesalePriceKgs != null ? e.wholesalePriceKgs.toString() : null;
      if (!item.retailShared) preserved++;
      if (e.wholesalePriceKgs != null && !item.wholesaleShared) preserved++;
      if (retail !== null || wholesale !== null) writes.push({ ...identity, retail, wholesale });
      if (writes.length > 100_000) throw new AppError("priceBookScopeTooLarge", "BAD_REQUEST", 400);
    }
  }
  return {
    entries: [...entries.values()],
    bindings,
    items: [...items.values()],
    writes,
    summary: {
      ...summarize(state, writes, preserved, c.kind),
      ...listChanges(state, [...entries.values()]),
    },
  };
}

function issueToken(input: Request, state: State) {
  const body = Buffer.from(
    JSON.stringify({
      org: input.user.organizationId,
      actor: input.user.id,
      book: input.bookId,
      change: hash(input.change),
      state: digest(state),
      expires: Date.now() + 10 * 60_000,
    }),
  ).toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(body).digest("hex")}`;
}
function verifyTokenAuthority(token: string, input: Request) {
  try {
    const [body, signature, extra] = token.split("."),
      expected = createHmac("sha256", secret()).update(body).digest("hex");
    if (
      extra ||
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      throw stale();
    const d = JSON.parse(Buffer.from(body, "base64url").toString());
    if (
      d.org !== input.user.organizationId ||
      d.actor !== input.user.id ||
      d.book !== input.bookId ||
      d.change !== hash(input.change)
    )
      throw stale();
    return d as { state: string; expires: number };
  } catch {
    throw stale();
  }
}
function verifyToken(token: string, input: Request, state: State) {
  const d = verifyTokenAuthority(token, input);
  if (d.state !== digest(state) || d.expires < Date.now()) throw stale();
}

type PublicationReceipt =
  | { changeId: string; version: number; stores: string[] }
  | { canceled: true };

export async function previewPriceBook(input: Request) {
  await authorize(input.user);
  return prisma.$transaction(
    async (tx) => {
      const scope = await requestedScope(tx, input),
        state = await loadState(tx, input.user.organizationId, input.bookId, scope);
      for (const id of state.scope.storeIds) await assertUserCanAccessStore(tx, input.user, id);
      const p = await plan(tx, input, state);
      return {
        ...p.summary,
        listPositions: p.entries.length,
        connectedStores: p.bindings.length,
        token: issueToken(input, state),
        version: state.book.version,
      };
    },
    { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 120_000 },
  );
}

async function chunks<T>(rows: T[], run: (rows: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += 2000) await run(rows.slice(i, i + 2000));
}

async function persistCatalog(tx: Tx, org: string, book: string, p: Plan, before: State) {
  const entryKeys = new Set(p.entries.map((e) => key(e.productId, e.variantKey)));
  const bindingKeys = new Set(p.bindings.map((e) => e.storeId));
  const itemKeys = new Set(p.items.map(itemKey));
  await tx.priceBookEntry.deleteMany({
    where: {
      organizationId: org,
      bookId: book,
      id: {
        in: before.entries
          .filter((e) => !entryKeys.has(key(e.productId, e.variantKey)))
          .map((e) => e.id),
      },
    },
  });
  await chunks(
    before.items.filter((e) => !itemKeys.has(itemKey(e))).map((e) => e.id),
    (ids) =>
      tx.priceBookStoreItem.deleteMany({
        where: { organizationId: org, bookId: book, id: { in: ids } },
      }),
  );
  await tx.priceBookStore.deleteMany({
    where: {
      organizationId: org,
      bookId: book,
      id: { in: before.bindings.filter((e) => !bindingKeys.has(e.storeId)).map((e) => e.id) },
    },
  });
  const oldEntries = new Map(before.entries.map((e) => [key(e.productId, e.variantKey), e]));
  await chunks(
    p.entries.filter((e) => {
      const old = oldEntries.get(key(e.productId, e.variantKey));
      return (
        !old ||
        old.retailPriceKgs.toString() !== e.retailPriceKgs.toString() ||
        old.wholesalePriceKgs?.toString() !== e.wholesalePriceKgs?.toString()
      );
    }),
    async (rows) => {
      await tx.$executeRaw`
      INSERT INTO "PriceBookEntry" (id,"organizationId","bookId","productId","variantKey","baseUnitId","retailPriceKgs","wholesalePriceKgs")
      SELECT r.id, ${org}, ${book}, r."productId", r."variantKey", r."baseUnitId", r."retailPriceKgs"::numeric, r."wholesalePriceKgs"::numeric
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(id text,"productId" text,"variantKey" text,"baseUnitId" text,"retailPriceKgs" text,"wholesalePriceKgs" text)
      ON CONFLICT ("bookId","productId","variantKey") DO UPDATE SET "retailPriceKgs"=EXCLUDED."retailPriceKgs", "wholesalePriceKgs"=EXCLUDED."wholesalePriceKgs"`;
    },
  );
  const oldBindings = new Map(before.bindings.map((e) => [e.storeId, e]));
  for (const b of p.bindings) {
    const old = oldBindings.get(b.storeId);
    if (!old) await tx.priceBookStore.create({ data: b });
    else if (old.preserveLocal !== b.preserveLocal)
      await tx.priceBookStore.update({
        where: { id: old.id },
        data: { preserveLocal: b.preserveLocal },
      });
  }
  const oldItems = new Map(before.items.map((e) => [itemKey(e), e]));
  await chunks(
    p.items.filter((e) => {
      const old = oldItems.get(itemKey(e));
      return (
        !old || old.retailShared !== e.retailShared || old.wholesaleShared !== e.wholesaleShared
      );
    }),
    async (rows) => {
      await tx.$executeRaw`
      INSERT INTO "PriceBookStoreItem" (id,"organizationId","bookId","storeId","productId","variantKey","retailShared","wholesaleShared")
      SELECT r.id, ${org}, ${book}, r."storeId", r."productId", r."variantKey", r."retailShared", r."wholesaleShared"
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(id text,"storeId" text,"productId" text,"variantKey" text,"retailShared" boolean,"wholesaleShared" boolean)
      ON CONFLICT ("storeId","productId","variantKey") DO UPDATE SET "retailShared"=EXCLUDED."retailShared", "wholesaleShared"=EXCLUDED."wholesaleShared"`;
    },
  );
}

async function materialize(tx: Tx, org: string, actor: string, writes: Plan["writes"]) {
  await chunks(writes, async (rows) => {
    const data = JSON.stringify(rows);
    await tx.$executeRaw`
      INSERT INTO "StorePrice" (id,"organizationId","storeId","productId","variantId","variantKey","priceKgs","updatedAt","updatedById")
      SELECT 'pb_' || md5(jsonb_build_array(${org}::text, r."storeId", r."productId", r."variantKey")::text), ${org}, r."storeId", r."productId", NULLIF(r."variantKey",'BASE'), r."variantKey", r.retail::numeric, CURRENT_TIMESTAMP, ${actor}
      FROM jsonb_to_recordset(${data}::jsonb) AS r("storeId" text,"productId" text,"variantKey" text,retail text,wholesale text)
      WHERE r.retail IS NOT NULL
      ON CONFLICT ("organizationId","storeId","productId","variantKey") DO UPDATE
      SET "priceKgs"=EXCLUDED."priceKgs", "updatedAt"=EXCLUDED."updatedAt", "updatedById"=EXCLUDED."updatedById"
      WHERE "StorePrice"."priceKgs" IS DISTINCT FROM EXCLUDED."priceKgs"`;
    await tx.$executeRaw`
      INSERT INTO "StorePriceTypes" (id,"organizationId","storeId","productId","variantId","variantKey","retailPriceKgs","wholesalePriceKgs","updatedAt","updatedById")
      SELECT 'pb_t_' || md5(jsonb_build_array(${org}::text, r."storeId", r."productId", r."variantKey")::text), ${org}, r."storeId", r."productId", NULLIF(r."variantKey",'BASE'), r."variantKey", r.retail::numeric, r.wholesale::numeric, CURRENT_TIMESTAMP, ${actor}
      FROM jsonb_to_recordset(${data}::jsonb) AS r("storeId" text,"productId" text,"variantKey" text,retail text,wholesale text)
      ON CONFLICT ("organizationId","storeId","productId","variantKey") DO UPDATE SET
      "retailPriceKgs"=COALESCE(EXCLUDED."retailPriceKgs", "StorePriceTypes"."retailPriceKgs"),
      "wholesalePriceKgs"=COALESCE(EXCLUDED."wholesalePriceKgs", "StorePriceTypes"."wholesalePriceKgs"),
      "updatedAt"=EXCLUDED."updatedAt", "updatedById"=EXCLUDED."updatedById"
      WHERE (EXCLUDED."retailPriceKgs" IS NOT NULL AND "StorePriceTypes"."retailPriceKgs" IS DISTINCT FROM EXCLUDED."retailPriceKgs")
         OR (EXCLUDED."wholesalePriceKgs" IS NOT NULL AND "StorePriceTypes"."wholesalePriceKgs" IS DISTINCT FROM EXCLUDED."wholesalePriceKgs")`;
  });
}

async function restorePrices(tx: Tx, org: string, before: State, current: State) {
  const priceKeys = new Set(before.prices.map(itemKey)),
    typeKeys = new Set(before.types.map(itemKey));
  await chunks(
    current.types.filter((r) => !typeKeys.has(itemKey(r))).map((r) => r.id),
    (ids) => tx.storePriceTypes.deleteMany({ where: { organizationId: org, id: { in: ids } } }),
  );
  await chunks(
    current.prices.filter((r) => !priceKeys.has(itemKey(r))).map((r) => r.id),
    (ids) => tx.storePrice.deleteMany({ where: { organizationId: org, id: { in: ids } } }),
  );
  const currentPrices = new Map(current.prices.map((r) => [itemKey(r), r])),
    currentTypes = new Map(current.types.map((r) => [itemKey(r), r]));
  await chunks(
    before.prices.filter((r) => hash(r) !== hash(currentPrices.get(itemKey(r)))),
    async (rows) => {
      await tx.$executeRaw`
      INSERT INTO "StorePrice" SELECT * FROM jsonb_populate_recordset(NULL::"StorePrice", ${JSON.stringify(rows)}::jsonb)
      ON CONFLICT ("organizationId","storeId","productId","variantKey") DO UPDATE SET
      "priceKgs"=EXCLUDED."priceKgs", "retailPriceKgs"=EXCLUDED."retailPriceKgs", "wholesalePriceKgs"=EXCLUDED."wholesalePriceKgs",
      "discountType"=EXCLUDED."discountType", "discountPercentage"=EXCLUDED."discountPercentage", "discountStartsAt"=EXCLUDED."discountStartsAt", "discountEndsAt"=EXCLUDED."discountEndsAt", "discountCreatedById"=EXCLUDED."discountCreatedById", "discountUpdatedAt"=EXCLUDED."discountUpdatedAt",
      "updatedAt"=EXCLUDED."updatedAt", "updatedById"=EXCLUDED."updatedById"`;
    },
  );
  await chunks(
    before.types.filter((r) => hash(r) !== hash(currentTypes.get(itemKey(r)))),
    async (rows) => {
      await tx.$executeRaw`
      INSERT INTO "StorePriceTypes" SELECT * FROM jsonb_populate_recordset(NULL::"StorePriceTypes", ${JSON.stringify(rows)}::jsonb)
      ON CONFLICT ("organizationId","storeId","productId","variantKey") DO UPDATE SET
      "retailPriceKgs"=EXCLUDED."retailPriceKgs", "wholesalePriceKgs"=EXCLUDED."wholesalePriceKgs", "updatedAt"=EXCLUDED."updatedAt", "updatedById"=EXCLUDED."updatedById"`;
    },
  );
}

export async function applyPriceBook(
  input: Request & { token: string; idempotencyKey: string; requestId: string },
) {
  await authorize(input.user);
  let result: { changeId: string; version: number; stores: string[] };
  try {
    const committed = await prisma.$transaction(
      async (tx) =>
        withIdempotency<PublicationReceipt>(
          tx,
          {
            route: "priceBooks.apply",
            userId: input.user.id,
            key: input.idempotencyKey,
            request: toJson({
              organizationId: input.user.organizationId,
              bookId: input.bookId,
              change: input.change,
              token: input.token,
            }),
          },
          async () => {
            const scope = await requestedScope(tx, input),
              state = await loadState(tx, input.user.organizationId, input.bookId, scope);
            for (const id of state.scope.storeIds)
              await assertUserCanAccessStore(tx, input.user, id);
            verifyToken(input.token, input, state);
            const p = await plan(tx, input, state);
            await tx.$executeRaw`SELECT set_config('bazaar.price_book_write', 'on', true)`;
            await persistCatalog(tx, input.user.organizationId, input.bookId, p, state);
            if (p.restore) await restorePrices(tx, input.user.organizationId, p.restore, state);
            else await materialize(tx, input.user.organizationId, input.user.id, p.writes);
            const updated = await tx.priceBook.update({
              where: { id: input.bookId },
              data: { version: { increment: 1 } },
            });
            const after = await loadState(
              tx,
              input.user.organizationId,
              input.bookId,
              state.scope,
              false,
            );
            const receipt = await tx.priceBookChange.create({
              data: {
                organizationId: input.user.organizationId,
                bookId: input.bookId,
                actorId: input.user.id,
                kind: input.change.kind,
                version: updated.version,
                scope: toJson(state.scope),
                before: { format: "ndjson-gzip-v2" },
                snapshot: await encodePriceBookSnapshot(state),
                afterHash: digest(after),
                summary: toJson(p.summary),
              },
            });
            await writeAuditLog(tx, {
              organizationId: input.user.organizationId,
              actorId: input.user.id,
              action: `PRICE_BOOK_${input.change.kind}`,
              entity: "PriceBook",
              entityId: input.bookId,
              before: toJson({ version: state.book.version, hash: digest(state) }),
              after: toJson({ changeId: receipt.id, version: updated.version, ...p.summary }),
              requestId: input.requestId,
            });
            return { changeId: receipt.id, version: updated.version, stores: state.scope.storeIds };
          },
        ),
      { isolationLevel: "Serializable", maxWait: 15_000, timeout: 120_000 },
    );
    if ("canceled" in committed.result)
      throw new AppError("priceBookAttemptClosed", "CONFLICT", 409);
    result = committed.result;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (["P2034", "P2002"].includes(error.code) ||
        (error.code === "P2010" && ["40001", "40P01"].includes(String(error.meta?.code))))
    )
      throw stale();
    throw error;
  }
  await notifyPriceBookChange(input.user.organizationId, result);
  return result;
}

async function notifyPriceBookChange(
  organizationId: string,
  result: Exclude<PublicationReceipt, { canceled: true }>,
) {
  // A committed publication remains successful if a cache/pubsub service is down.
  for (const storeId of result.stores) {
    try {
      await Promise.all([
        invalidateBazaarCatalogCacheForStore(organizationId, storeId),
        invalidateBazaarApiProductsCacheForStore(organizationId, storeId),
      ]);
      eventBus.publish({ type: "pricing.updated", payload: { storeId } });
    } catch {
      getLogger().warn(
        { storeId, changeId: result.changeId },
        "committed shared price notification failed",
      );
    }
  }
}

export async function listPriceBooks(user: StoreAccessUser) {
  await authorize(user);
  const [books, bindings, stores] = await Promise.all([
    prisma.priceBook.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { name: "asc" },
    }),
    prisma.priceBookStore.findMany({ where: { organizationId: user.organizationId } }),
    prisma.store.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true, currencyCode: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { books, bindings, stores, actorId: user.id, organizationId: user.organizationId };
}

export async function readPriceBook(input: {
  user: StoreAccessUser;
  bookId: string;
  search?: string;
  page: number;
  storeId?: string;
}) {
  await authorize(input.user);
  const org = input.user.organizationId;
  const book = await prisma.priceBook.findFirst({
    where: { id: input.bookId, organizationId: org },
  });
  if (!book) throw new AppError("recordNotFound", "NOT_FOUND", 404);
  if (input.storeId) await assertUserCanAccessStore(prisma, input.user, input.storeId);
  const search = input.search?.trim();
  const products = await prisma.product.findMany({
    where: {
      organizationId: org,
      isDeleted: false,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { sku: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      sku: true,
      name: true,
      baseUnitId: true,
      baseUnit: { select: { labelRu: true, labelKg: true, code: true } },
      variants: {
        where: { isActive: true },
        select: { id: true, name: true, sku: true },
        orderBy: { id: "asc" },
      },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 50,
    skip: (input.page - 1) * 50,
  });
  const [total, entries, items, bindings, history, prices, types, orgSettings] = await Promise.all([
    prisma.product.count({
      where: {
        organizationId: org,
        isDeleted: false,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { sku: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
    }),
    prisma.priceBookEntry.findMany({
      where: { organizationId: org, bookId: book.id, productId: { in: products.map((p) => p.id) } },
    }),
    prisma.priceBookStoreItem.findMany({
      where: {
        organizationId: org,
        bookId: book.id,
        ...(input.storeId ? { storeId: input.storeId } : { storeId: "" }),
        productId: { in: products.map((p) => p.id) },
      },
    }),
    prisma.priceBookStore.findMany({ where: { organizationId: org, bookId: book.id } }),
    prisma.priceBookChange.findMany({
      where: { organizationId: org, bookId: book.id },
      select: {
        id: true,
        kind: true,
        version: true,
        summary: true,
        createdAt: true,
        actorId: true,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    input.storeId
      ? prisma.storePrice.findMany({
          where: {
            organizationId: org,
            storeId: input.storeId,
            productId: { in: products.map((p) => p.id) },
          },
        })
      : [],
    input.storeId
      ? prisma.storePriceTypes.findMany({
          where: {
            organizationId: org,
            storeId: input.storeId,
            productId: { in: products.map((p) => p.id) },
          },
        })
      : [],
    prisma.organization.findUniqueOrThrow({
      where: { id: org },
      select: { retailWholesaleEnabled: true },
    }),
  ]);
  const actors = await prisma.user.findMany({
    where: { organizationId: org, id: { in: history.map((h) => h.actorId) } },
    select: { id: true, name: true },
  });
  return {
    book,
    total,
    page: input.page,
    products,
    entries,
    items,
    bindings,
    prices,
    types,
    retailWholesaleEnabled: orgSettings.retailWholesaleEnabled,
    history: history.map((h) => ({
      ...h,
      actorName: actors.find((a) => a.id === h.actorId)?.name ?? h.actorId,
    })),
  };
}

/** Same immutable product/variant IDs, including explicit zero. Never writes prices or assignments. */
export async function compareStorePrices(input: {
  user: StoreAccessUser;
  sourceId: string;
  targetId: string;
  search?: string;
  onlyDifferences: boolean;
  page: number;
}) {
  await authorize(input.user);
  if (input.sourceId === input.targetId) throw invalid();
  await assertUserCanAccessStore(prisma, input.user, input.sourceId);
  await assertUserCanAccessStore(prisma, input.user, input.targetId);
  const org = input.user.organizationId;
  const source = await prisma.store.findFirstOrThrow({
    where: { id: input.sourceId, organizationId: org },
    select: { id: true, name: true, currencyCode: true },
  });
  const target = await prisma.store.findFirstOrThrow({
    where: { id: input.targetId, organizationId: org },
    select: { id: true, name: true, currencyCode: true },
  });
  const settings = await prisma.organization.findUniqueOrThrow({
    where: { id: org },
    select: { retailWholesaleEnabled: true },
  });
  const sql = Prisma.sql`
    WITH positions AS (
      SELECT p.id, p.name, p.sku, p."baseUnitId", p."basePriceKgs", 'BASE' AS "variantKey", NULL::text AS "variantName"
      FROM "Product" p WHERE p."organizationId"=${org} AND NOT p."isDeleted"
      UNION ALL
      SELECT p.id, p.name, p.sku, p."baseUnitId", p."basePriceKgs", v.id, v.name
      FROM "Product" p JOIN "ProductVariant" v ON v."productId"=p.id AND v."isActive"
      WHERE p."organizationId"=${org} AND NOT p."isDeleted"
    ), comparison AS (
      SELECT p.id AS "productId", p.name, p.sku, p."variantKey", p."variantName", p."baseUnitId",
        COALESCE(a."isActive" AND NOT a."isHidden",false) AS "sourceAvailable", COALESCE(b."isActive" AND NOT b."isHidden",false) AS "targetAvailable",
        CASE WHEN ${settings.retailWholesaleEnabled} THEN COALESCE(at."retailPriceKgs", ap."priceKgs", CASE WHEN p."variantKey"='BASE' THEN p."basePriceKgs" END, at."wholesalePriceKgs", p."basePriceKgs") ELSE COALESCE(ap."priceKgs",p."basePriceKgs") END AS "sourceRetail",
        CASE WHEN ${settings.retailWholesaleEnabled} THEN COALESCE(bt."retailPriceKgs", bp."priceKgs", CASE WHEN p."variantKey"='BASE' THEN p."basePriceKgs" END, bt."wholesalePriceKgs", p."basePriceKgs") ELSE COALESCE(bp."priceKgs",p."basePriceKgs") END AS "targetRetail",
        at."wholesalePriceKgs" AS "sourceWholesale", bt."wholesalePriceKgs" AS "targetWholesale",
        COALESCE(at."retailPriceKgs",ap."priceKgs") AS "sourceExplicitRetail", COALESCE(bt."retailPriceKgs",bp."priceKgs") AS "targetExplicitRetail"
      FROM positions p
      LEFT JOIN "StoreProduct" a ON a."storeId"=${source.id} AND a."productId"=p.id AND a."organizationId"=${org}
      LEFT JOIN "StoreProduct" b ON b."storeId"=${target.id} AND b."productId"=p.id AND b."organizationId"=${org}
      LEFT JOIN "StorePrice" ap ON ap."storeId"=${source.id} AND ap."productId"=p.id AND ap."variantKey"=p."variantKey" AND ap."organizationId"=${org}
      LEFT JOIN "StorePrice" bp ON bp."storeId"=${target.id} AND bp."productId"=p.id AND bp."variantKey"=p."variantKey" AND bp."organizationId"=${org}
      LEFT JOIN "StorePriceTypes" at ON at."storeId"=${source.id} AND at."productId"=p.id AND at."variantKey"=p."variantKey" AND at."organizationId"=${org}
      LEFT JOIN "StorePriceTypes" bt ON bt."storeId"=${target.id} AND bt."productId"=p.id AND bt."variantKey"=p."variantKey" AND bt."organizationId"=${org}
      WHERE (a."isActive" OR b."isActive") AND (${input.search?.trim() ?? ""}='' OR p.name ILIKE ${`%${input.search?.trim() ?? ""}%`} OR p.sku ILIKE ${`%${input.search?.trim() ?? ""}%`})
    ), classified AS (
      SELECT *, ("sourceRetail" IS DISTINCT FROM "targetRetail" OR "sourceWholesale" IS DISTINCT FROM "targetWholesale" OR "sourceAvailable" IS DISTINCT FROM "targetAvailable" OR "sourceExplicitRetail" IS DISTINCT FROM "targetExplicitRetail") AS different
      FROM comparison
    )`;
  type Row = {
    productId: string;
    name: string;
    sku: string;
    variantKey: string;
    variantName: string | null;
    baseUnitId: string;
    sourceAvailable: boolean;
    targetAvailable: boolean;
    sourceRetail: Prisma.Decimal | null;
    targetRetail: Prisma.Decimal | null;
    sourceWholesale: Prisma.Decimal | null;
    targetWholesale: Prisma.Decimal | null;
    sourceExplicitRetail: Prisma.Decimal | null;
    targetExplicitRetail: Prisma.Decimal | null;
    different: boolean;
  };
  const [rows, counts] = await Promise.all([
    prisma.$queryRaw<Row[]>(
      Prisma.sql`${sql} SELECT * FROM classified WHERE NOT ${input.onlyDifferences} OR different ORDER BY name, "productId", "variantKey" LIMIT 50 OFFSET ${(input.page - 1) * 50}`,
    ),
    prisma.$queryRaw<
      Array<{ total: bigint; different: bigint; missingTarget: bigint; zeroTarget: bigint }>
    >(
      Prisma.sql`${sql} SELECT count(*) AS total, count(*) FILTER (WHERE different) AS different, count(*) FILTER (WHERE "targetExplicitRetail" IS NULL) AS "missingTarget", count(*) FILTER (WHERE "targetExplicitRetail"=0) AS "zeroTarget" FROM classified`,
    ),
  ]);
  return {
    source,
    target,
    rows,
    total: Number(input.onlyDifferences ? counts[0].different : counts[0].total),
    counts: {
      total: Number(counts[0].total),
      different: Number(counts[0].different),
      missingTarget: Number(counts[0].missingTarget),
      zeroTarget: Number(counts[0].zeroTarget),
    },
    readOnly: true as const,
    currencyCode: "KGS",
  };
}

export async function preparePriceBookBulk(input: {
  user: StoreAccessUser;
  bookId: string;
  kind: "RETAIL" | "WHOLESALE";
  mode: "SET" | "PERCENT" | "AMOUNT";
  value: number;
  productIds?: string[];
}) {
  await authorize(input.user);
  const book = await prisma.priceBook.findFirst({
    where: { id: input.bookId, organizationId: input.user.organizationId },
  });
  if (!book) throw new AppError("recordNotFound", "NOT_FOUND", 404);
  const candidates = await prisma.priceBookEntry.findMany({
    where: {
      bookId: book.id,
      organizationId: input.user.organizationId,
      product: { isDeleted: false },
      ...(input.productIds ? { productId: { in: input.productIds } } : {}),
    },
    orderBy: [{ productId: "asc" }, { variantKey: "asc" }],
    take: 10_001,
  });
  if (candidates.length > 10_000) throw new AppError("priceBookScopeTooLarge", "BAD_REQUEST", 400);
  const variantKeys = candidates.filter((e) => e.variantKey !== "BASE").map((e) => e.variantKey);
  const activeVariants = new Set(
    variantKeys.length
      ? (
          await prisma.productVariant.findMany({
            where: {
              id: { in: variantKeys },
              isActive: true,
              product: { organizationId: input.user.organizationId },
            },
            select: { id: true },
          })
        ).map((v) => v.id)
      : [],
  );
  // Archived positions remain frozen. Their historical prices must neither
  // enter an unseen mass edit nor prevent editing the active assortment.
  const entries = candidates.filter(
    (e) => e.variantKey === "BASE" || activeVariants.has(e.variantKey),
  );
  if (!entries.length) throw new AppError("priceBookEmptySelection", "BAD_REQUEST", 400);
  if (
    input.kind === "WHOLESALE" &&
    input.mode !== "SET" &&
    entries.some((e) => e.wholesalePriceKgs == null)
  )
    throw new AppError("priceBookMissingWholesale", "BAD_REQUEST", 400);
  const result = entries.map((e) => {
    const old = input.kind === "RETAIL" ? e.retailPriceKgs : e.wholesalePriceKgs;
    const value = new Prisma.Decimal(input.value);
    const next = (
      input.mode === "SET"
        ? value
        : input.mode === "PERCENT"
          ? old!.mul(value.div(100).plus(1))
          : old!.plus(value)
    ).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (next.isNegative() || next.greaterThan("9999999999.99"))
      throw new AppError("priceBookAmountInvalid", "BAD_REQUEST", 400);
    return {
      productId: e.productId,
      variantId: e.variantKey === "BASE" ? null : e.variantKey,
      retailPriceKgs: Number(input.kind === "RETAIL" ? next : e.retailPriceKgs),
      wholesalePriceKgs:
        input.kind === "WHOLESALE" ? Number(next) : (e.wholesalePriceKgs?.toNumber() ?? null),
    };
  });
  return { kind: "PRICES" as const, entries: result, expectedVersion: book.version };
}

/** Preparation only. No prices or assignments are written until a separate signed preview is confirmed. */
export async function preparePriceBookFromStore(input: {
  user: StoreAccessUser;
  bookId: string;
  sourceId: string;
  replaceExisting: boolean;
}) {
  await authorize(input.user);
  await assertUserCanAccessStore(prisma, input.user, input.sourceId);
  return prisma.$transaction(
    async (tx) => {
      const org = input.user.organizationId;
      const book = await tx.priceBook.findFirst({
        where: { id: input.bookId, organizationId: org },
      });
      if (!book) throw new AppError("recordNotFound", "NOT_FOUND", 404);
      const orgSettings = await tx.organization.findUniqueOrThrow({
        where: { id: org },
        select: { retailWholesaleEnabled: true },
      });
      const [products, prices, types, existing] = await Promise.all([
        tx.product.findMany({
          where: {
            organizationId: org,
            isDeleted: false,
            storeProducts: { some: { storeId: input.sourceId, isActive: true, isHidden: false } },
          },
          select: {
            id: true,
            basePriceKgs: true,
            variants: { where: { isActive: true }, select: { id: true } },
          },
          orderBy: { id: "asc" },
          take: 10_001,
        }),
        tx.storePrice.findMany({ where: { organizationId: org, storeId: input.sourceId } }),
        tx.storePriceTypes.findMany({ where: { organizationId: org, storeId: input.sourceId } }),
        tx.priceBookEntry.findMany({ where: { organizationId: org, bookId: book.id } }),
      ]);
      if (products.length > 10_000)
        throw new AppError("priceBookScopeTooLarge", "BAD_REQUEST", 400);
      const standards = new Map(prices.map((p) => [key(p.productId, p.variantKey), p.priceKgs]));
      const extras = new Map(types.map((p) => [key(p.productId, p.variantKey), p]));
      const old = new Map(existing.map((e) => [key(e.productId, e.variantKey), e]));
      const entries: Extract<PriceBookChangeInput, { kind: "PRICES" }>["entries"] = [];
      let missing = 0,
        retained = 0;
      for (const p of products)
        for (const variantKey of ["BASE", ...p.variants.map((v) => v.id)]) {
          const k = key(p.id, variantKey),
            ex = extras.get(k),
            previous = old.get(k);
          if (previous && !input.replaceExisting) {
            retained++;
            continue;
          }
          const ordinary = standards.get(k);
          const retail = orgSettings.retailWholesaleEnabled
            ? (ex?.retailPriceKgs ??
              ordinary ??
              (variantKey === "BASE" ? p.basePriceKgs : null) ??
              ex?.wholesalePriceKgs ??
              p.basePriceKgs)
            : (ordinary ?? p.basePriceKgs);
          if (retail == null) {
            missing++;
            continue;
          }
          entries.push({
            productId: p.id,
            variantId: variantKey === "BASE" ? null : variantKey,
            retailPriceKgs: Number(retail),
            wholesalePriceKgs:
              ex?.wholesalePriceKgs?.toNumber() ?? previous?.wholesalePriceKgs?.toNumber() ?? null,
          });
        }
      if (entries.length > 10_000) throw new AppError("priceBookScopeTooLarge", "BAD_REQUEST", 400);
      if (!entries.length) throw new AppError("priceBookEmptySelection", "BAD_REQUEST", 400);
      return {
        change: { kind: "PRICES" as const, entries, expectedVersion: book.version },
        missing,
        retained,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 120_000 },
  );
}

/** Claim the original operation key: an in-flight publisher finishes first; an
 * unclaimed attempt becomes terminal, including requests arriving afterwards. */
export async function reconcilePriceBookAttempt(
  input: Request & { token: string; idempotencyKey: string; requestId: string },
) {
  await authorize(input.user);
  verifyTokenAuthority(input.token, input);
  const outcome = await prisma.$transaction(
    async (tx) => {
      if (
        !(await tx.priceBook.findFirst({
          where: { id: input.bookId, organizationId: input.user.organizationId },
          select: { id: true },
        }))
      )
        throw invalid();
      return withIdempotency<PublicationReceipt>(
        tx,
        {
          route: "priceBooks.apply",
          userId: input.user.id,
          key: input.idempotencyKey,
          request: toJson({
            organizationId: input.user.organizationId,
            bookId: input.bookId,
            change: input.change,
            token: input.token,
          }),
        },
        async () => {
          await writeAuditLog(tx, {
            organizationId: input.user.organizationId,
            actorId: input.user.id,
            action: "PRICE_BOOK_ATTEMPT_CANCELED",
            entity: "PriceBook",
            entityId: input.bookId,
            after: { canceled: true },
            requestId: input.requestId,
          });
          return { canceled: true };
        },
      );
    },
    { maxWait: 15_000, timeout: 120_000 },
  );
  if (!("canceled" in outcome.result))
    await notifyPriceBookChange(input.user.organizationId, outcome.result);
  return "canceled" in outcome.result
    ? { status: "CANCELED" as const }
    : { status: "POSTED" as const, changeId: outcome.result.changeId };
}
