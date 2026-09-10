import { z } from "zod";
import { baamText } from "./companion";

export const workflowActions = [
  "product_create",
  "product_update",
  "product_assign_store",
  "stock_receive",
  "stock_adjust",
  "stock_set",
  "stock_write_off",
  "stock_transfer",
  "supplier_create",
  "supplier_update",
  "customer_create",
  "customer_update",
  "purchase_create",
  "purchase_submit",
  "purchase_approve",
  "purchase_cancel",
  "purchase_receive",
  "purchase_receive_lines",
  "purchase_add_line",
  "purchase_update_line",
  "purchase_remove_line",
  "order_create",
  "order_confirm",
  "order_markReady",
  "order_complete",
  "order_cancel",
  "order_add_line",
  "order_update_line",
  "order_remove_line",
  "pos_create_draft",
  "pos_complete",
  "pos_holdDraft",
  "pos_resumeHeldDraft",
  "pos_cancelDraft",
  "pos_add_line",
  "pos_update_line",
  "pos_remove_line",
  "pos_open_shift",
  "count_create",
  "count_set_quantity",
  "count_remove_line",
  "count_applyCount",
  "count_cancel",
  "return_create_draft",
  "return_complete",
  "return_cancel",
  "return_add_line",
  "return_update_line",
  "return_remove_line",
] as const;
export type WorkflowAction = (typeof workflowActions)[number];
export const lookupKinds = [
  "stores",
  "products",
  "units",
  "attributes",
  "customers",
  "suppliers",
  "registers",
  "sales",
  "orders",
  "purchases",
  "stock_counts",
  "returns",
  "variants",
  "lines",
  "shifts",
] as const;
export type WorkflowLookupKind = (typeof lookupKinds)[number];
export type WorkflowValue =
  | string
  | number
  | boolean
  | null
  | WorkflowValue[]
  | { [key: string]: WorkflowValue };
export type WorkflowValues = Record<string, WorkflowValue>;
const valueSchema: z.ZodType<WorkflowValue> = z.lazy(() =>
  z.union([
    z.string().max(6000),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(valueSchema).max(40),
    z.record(
      z
        .string()
        .max(100)
        .refine((k) => !["__proto__", "constructor", "prototype"].includes(k)),
      valueSchema,
    ),
  ]),
);
export const workflowValuesSchema = z
  .record(
    z
      .string()
      .max(100)
      .refine((k) => !["__proto__", "constructor", "prototype"].includes(k)),
    valueSchema,
  )
  .superRefine((value, ctx) => {
    if (JSON.stringify(value).length > 40000)
      ctx.addIssue({ code: "custom", message: "baamResultTooLarge" });
    const depth = (v: WorkflowValue, level = 0): boolean =>
      level <= 6 &&
      (v === null || typeof v !== "object" || Object.values(v).every((x) => depth(x, level + 1)));
    if (!depth(value)) ctx.addIssue({ code: "custom", message: "invalidInput" });
  });
export type WorkflowOption = {
  value: string;
  label: string;
  detail?: string;
  extra?: WorkflowValues;
};
export type WorkflowField = {
  key: string;
  label: string;
  kind: "text" | "number" | "boolean" | "select" | "lookup" | "array" | "object" | "photo" | "date";
  required: boolean;
  advanced?: boolean;
  integer?: boolean;
  min?: number;
  max?: number;
  options?: WorkflowOption[];
  lookup?: WorkflowLookupKind;
  fields?: WorkflowField[];
  item?: WorkflowField;
};
export type WorkflowPresentation = {
  reviews?: Array<{ entity: string; id: string; updatedAt: string }>;
  stockReview?: {
    storeId: string;
    productId: string;
    variantId: string | null;
    version: number;
    onHand: number;
  };
  title: string;
  fields: WorkflowField[];
  labels: Record<string, string>;
  choices: Record<string, WorkflowOption[]>;
  errors: Record<string, string>;
  storeId?: string;
  totalKgs?: number;
  number?: string;
  documentStatus?: string;
  isHeld?: boolean;
  saleFingerprint?: string;
  note?: string;
};
export const workflowOperationSchema = z.enum([
  "execute",
  "prepare",
  "complete",
  "hold",
  "resume",
  "cancelReceipt",
  "cancel",
  "refresh",
]);
export type WorkflowOperation = z.infer<typeof workflowOperationSchema>;
export const workflowSaveSchema = z
  .object({
    id: z.string().min(1),
    revision: z.number().int().nonnegative(),
    parameters: workflowValuesSchema,
  })
  .strict();
export const workflowSubmitSchema = workflowSaveSchema
  .extend({ clientRequestId: z.string().uuid(), operation: workflowOperationSchema })
  .strict();
export const workflowCommandSchema = z
  .object({
    kind: z.enum(["action", "report", "help", "search"]),
    action: z.enum(workflowActions).optional(),
    sourceWorkflowId: z.string().max(100).optional(),
    query: z.string().max(160).optional(),
    period: z.enum(["today", "yesterday", "week", "month"]).optional(),
  })
  .strict();
export type WorkflowCommand = z.infer<typeof workflowCommandSchema>;

const actionLabels: Record<string, [string, string, string]> = {
  product_create: ["Создать товар", "Create product", "Товар түзүү"],
  product_update: ["Изменить товар", "Edit product", "Товарды өзгөртүү"],
  product_assign_store: [
    "Добавить товары в магазин",
    "Assign products to a store",
    "Товарларды дүкөнгө кошуу",
  ],
  stock_receive: ["Оприходовать товары", "Receive stock", "Товарларды кириштөө"],
  stock_adjust: ["Скорректировать остаток", "Adjust stock", "Калдыкты оңдоо"],
  stock_set: ["Указать фактический остаток", "Set actual stock", "Иш жүзүндөгү калдыкты көрсөтүү"],
  stock_write_off: ["Списать товары", "Write off stock", "Товарларды эсептен чыгаруу"],
  stock_transfer: ["Переместить товары", "Transfer stock", "Товарларды которуу"],
  supplier_create: ["Создать поставщика", "Create supplier", "Жеткирүүчүнү түзүү"],
  supplier_update: ["Изменить поставщика", "Edit supplier", "Жеткирүүчүнү өзгөртүү"],
  customer_create: ["Создать клиента", "Create customer", "Кардарды түзүү"],
  customer_update: ["Изменить клиента", "Edit customer", "Кардарды өзгөртүү"],
  purchase_create: [
    "Создать заказ поставщику",
    "Create purchase order",
    "Жеткирүүчүгө буйрутма түзүү",
  ],
  purchase_submit: ["Отправить заказ поставщику", "Submit purchase order", "Буйрутманы жөнөтүү"],
  purchase_approve: ["Утвердить закупку", "Approve purchase", "Сатып алууну бекитүү"],
  purchase_cancel: ["Отменить закупку", "Cancel purchase", "Сатып алууну жокко чыгаруу"],
  purchase_receive: [
    "Принять заказ поставщика",
    "Receive purchase order",
    "Жеткирүүчүнүн буйрутмасын кабыл алуу",
  ],
  purchase_receive_lines: [
    "Частично принять заказ",
    "Receive selected quantities",
    "Тандалган сандарды кабыл алуу",
  ],
  order_create: ["Создать заказ клиента", "Create customer order", "Кардардын буйрутмасын түзүү"],
  order_confirm: ["Подтвердить заказ", "Confirm order", "Буйрутманы ырастоо"],
  order_markReady: ["Заказ готов", "Mark order ready", "Буйрутма даяр"],
  order_complete: ["Завершить заказ", "Complete order", "Буйрутманы бүтүрүү"],
  order_cancel: ["Отменить заказ", "Cancel order", "Буйрутманы жокко чыгаруу"],
  pos_create_draft: ["Подготовить чек", "Prepare receipt", "Чекти даярдоо"],
  pos_complete: ["Завершить продажу", "Complete sale", "Сатууну бүтүрүү"],
  pos_holdDraft: ["Отложить чек", "Hold receipt", "Чекти кийинкиге калтыруу"],
  pos_resumeHeldDraft: ["Продолжить чек", "Resume receipt", "Чекти улантуу"],
  pos_cancelDraft: ["Отменить чек", "Cancel receipt", "Чекти жокко чыгаруу"],
  pos_open_shift: ["Открыть смену", "Open shift", "Сменаны ачуу"],
  count_create: ["Начать инвентаризацию", "Start stock count", "Инвентаризацияны баштоо"],
  count_set_quantity: [
    "Указать пересчитанное количество",
    "Enter counted quantity",
    "Саналган санды көрсөтүү",
  ],
  count_remove_line: [
    "Убрать строку инвентаризации",
    "Remove count line",
    "Инвентаризациянын сабын алып салуу",
  ],
  count_applyCount: ["Применить инвентаризацию", "Apply stock count", "Инвентаризацияны колдонуу"],
  count_cancel: ["Отменить инвентаризацию", "Cancel stock count", "Инвентаризацияны жокко чыгаруу"],
  return_create_draft: ["Подготовить возврат", "Prepare return", "Кайтарууну даярдоо"],
  return_complete: ["Завершить возврат", "Complete return", "Кайтарууну бүтүрүү"],
  return_cancel: ["Отменить возврат", "Cancel return", "Кайтарууну жокко чыгаруу"],
};
export function workflowTitle(action: string, locale: string): string {
  const label = actionLabels[action];
  if (label) return baamText(locale, ...label);
  const match = /^(purchase|order|pos|return)_(add|update|remove)_line$/.exec(action);
  if (match) {
    const domain =
      match[1] === "purchase"
        ? ["закупки", "purchase", "сатып алуу"]
        : match[1] === "order"
          ? ["заказа", "order", "буйрутма"]
          : match[1] === "pos"
            ? ["чека", "receipt", "чек"]
            : ["возврата", "return", "кайтаруу"];
    return match[2] === "add"
      ? baamText(
          locale,
          `Добавить товар: ${domain[0]}`,
          `Add ${domain[1]} line`,
          `${domain[2]}: товар кошуу`,
        )
      : match[2] === "update"
        ? baamText(
            locale,
            `Изменить строку ${domain[0]}`,
            `Edit ${domain[1]} line`,
            `${domain[2]} сабын өзгөртүү`,
          )
        : baamText(
            locale,
            `Убрать строку ${domain[0]}`,
            `Remove ${domain[1]} line`,
            `${domain[2]} сабын алып салуу`,
          );
  }
  return baamText(locale, "Действие", "Action", "Иш-аракет");
}
export function workflowGet(values: WorkflowValues, path: string): WorkflowValue | undefined {
  let current: WorkflowValue | undefined = values;
  for (const key of path.split(".")) {
    if (["__proto__", "constructor", "prototype"].includes(key)) return undefined;
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, WorkflowValue>)[key];
  }
  return current;
}
export function workflowSet(
  values: WorkflowValues,
  path: string,
  value: WorkflowValue | undefined,
): WorkflowValues {
  const keys = path.split(".");
  if (
    keys.length > 6 ||
    keys.some(
      (k) =>
        !/^(?:[a-zA-Z][a-zA-Z0-9]*|[0-9]{1,2})$/.test(k) ||
        ["__proto__", "constructor", "prototype"].includes(k),
    )
  )
    throw Error("invalidInput");
  const result = structuredClone(values);
  let target: Record<string, WorkflowValue> = result;
  keys.slice(0, -1).forEach((key, index) => {
    if (!target[key] || typeof target[key] !== "object")
      target[key] = /^\d+$/.test(keys[index + 1]) ? [] : {};
    target = target[key] as Record<string, WorkflowValue>;
  });
  if (value === undefined) delete target[keys.at(-1)!];
  else target[keys.at(-1)!] = value;
  return result;
}
