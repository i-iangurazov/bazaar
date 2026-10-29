import { baamRecordStatus } from "@/lib/baam/recordStatus";
import type { Context } from "@/server/trpc/trpc";
import { baamText, baamUriComponent, type BaamLocale, type BaamPart } from "@/lib/baam/companion";
import { baamSearch, baamSearchSchema } from "./baamReadTools";

export async function answerBaamRecords(
  ctx: Context,
  input: {
    kind: string;
    query?: string;
    storeId?: string;
    locale: BaamLocale;
  },
) {
  const value = baamSearchSchema.parse({
    kind: input.kind,
    query: input.query,
    storeId: input.storeId,
    offset: 0,
  });
  const found = (await baamSearch(ctx, value)) as {
    items: Array<Record<string, unknown>>;
    nextOffset: number | null;
  };
  const roots: Record<string, string> = {
    products: "/products",
    customers: "/customers",
    suppliers: "/suppliers",
    orders: "/sales/orders",
    purchases: "/purchase-orders",
    sales: "/pos/history",
    stock_counts: "/inventory/counts",
    returns: "/pos/history",
    stores: "/stores",
  };
  const href = (item: Record<string, unknown>) => {
    const id = encodeURIComponent(String(item.id));
    if (["orders", "purchases", "stock_counts"].includes(value.kind))
      return `${roots[value.kind]}/${id}`;
    if (value.kind === "customers")
      return `/customers?customerId=${id}${item.storeId ? `&storeId=${encodeURIComponent(String(item.storeId))}` : ""}`;
    if (value.kind === "sales") return `/pos/history?saleId=${id}`;
    if (value.kind === "returns")
      return `/pos/history?saleId=${encodeURIComponent(String(item.originalSaleId))}`;
    if (value.kind === "suppliers")
      return `/suppliers?q=${baamUriComponent(String(item.name ?? ""))}`;
    return roots[value.kind];
  };
  const parts: BaamPart[] = found.items.map((item, index) => {
    const title = String(
      item.name ??
        item.number ??
        item.code ??
        `${baamText(input.locale, "Документ", "Document", "Документ")} · ${String(item.id ?? index + 1).slice(-8)}`,
    );
    const displayFields: Array<{ label: string; value: string }> = [];
    if (item.status)
      displayFields.push({
        label: baamText(input.locale, "Статус", "Status", "Абал"),
        value: baamRecordStatus(String(item.status), input.locale),
      });
    if (item.totalKgs != null)
      displayFields.push({
        label: baamText(input.locale, "Сумма", "Amount", "Сумма"),
        value: `${new Intl.NumberFormat(input.locale === "kg" ? "ky-KG" : input.locale, { maximumFractionDigits: 2 }).format(Number(item.totalKgs))} KGS`,
      });
    if (item.customerName)
      displayFields.push({
        label: baamText(input.locale, "Клиент", "Customer", "Кардар"),
        value: String(item.customerName),
      });
    if (item.phone)
      displayFields.push({
        label: baamText(input.locale, "Телефон", "Phone", "Телефон"),
        value: String(item.phone),
      });
    const supplier = item.supplier as { name?: string } | undefined;
    if (supplier?.name)
      displayFields.push({
        label: baamText(input.locale, "Поставщик", "Supplier", "Жеткирүүчү"),
        value: supplier.name,
      });
    return {
      type: "record",
      id: String(item.id ?? index),
      title,
      sku: null,
      href: href(item),
      displayFields,
    };
  });
  const text = found.items.length
    ? baamText(
        input.locale,
        `Найдено записей: ${found.items.length}${found.nextOffset !== null ? ". Показаны первые 20; уточните поиск, чтобы сузить список." : "."}`,
        `Records found: ${found.items.length}${found.nextOffset !== null ? ". Showing the first 20; refine your search." : "."}`,
        `Табылган жазуулар: ${found.items.length}${found.nextOffset !== null ? ". Алгачкы 20 көрсөтүлдү; издөөнү тактаңыз." : "."}`,
      )
    : baamText(
        input.locale,
        "Подходящих записей не найдено. Уточните название или номер.",
        "No matching records found. Refine the name or number.",
        "Дал келген жазуулар табылган жок. Аталышын же номерин тактаңыз.",
      );
  parts.push({
    type: "link",
    href: roots[value.kind],
    label: baamText(
      input.locale,
      "Открыть раздел в Bazaar",
      "Open section in Bazaar",
      "Бөлүмдү Bazaar ичинде ачуу",
    ),
  });
  return { text, parts };
}
