import { canAccessAppRoute, hasPermission, type AppPermission, type AppRole, type RoleAccess } from "@/lib/roleAccess";

export type BaamNavigationLocale = "en" | "ru" | "kg";
export const BAAM_PAGE_CONTEXTS = ["products", "customers", "suppliers", "stores", "inventory", "sales", "reports", "imports", "integrations", "settings", "billing", "support", "baam", "dashboard", "unknown"] as const;
export type BaamPageContext = (typeof BAAM_PAGE_CONTEXTS)[number];
type Destination = {
  href: `/${string}`;
  permission: AppPermission;
  labels: Record<BaamNavigationLocale, string>;
  keywords: readonly string[];
  features?: readonly string[];
  roles?: readonly AppRole[];
};

// Static route metadata only. These are links to existing pages, never operations,
// generated record IDs, search results, or instructions to execute a mutation.
const destinations = {
  products: { href: "/products", permission: "viewProducts", labels: { en: "Products", ru: "Товары", kg: "Товарлар" }, keywords: ["product", "catalog", "товар", "каталог", "товарлар"] },
  customers: { href: "/customers", permission: "manageCustomers", labels: { en: "Customers", ru: "Клиенты", kg: "Кардарлар" }, keywords: ["customer", "client", "клиент", "покупател", "кардар"] },
  suppliers: { href: "/suppliers", permission: "viewSuppliers", labels: { en: "Suppliers", ru: "Поставщики", kg: "Жеткирүүчүлөр" }, keywords: ["supplier", "vendor", "поставщик", "жеткирүүчү"] },
  stores: { href: "/stores", permission: "viewStores", labels: { en: "Stores", ru: "Магазины", kg: "Дүкөндөр" }, keywords: ["store", "shop", "магазин", "дүкөн"] },
  inventory: { href: "/inventory", permission: "viewInventory", labels: { en: "Stock balances", ru: "Остатки товаров", kg: "Товар калдыктары" }, keywords: ["inventory", "stock balances", "stock", "остатк", "склад", "кампа", "товар калдык"] },
  movements: { href: "/inventory/movements", permission: "viewInventory", labels: { en: "Stock movement history", ru: "История движения товаров", kg: "Товар кыймылынын тарыхы" }, keywords: ["movement", "stock history", "stock movement", "product movement", "движен", "истори товар", "истори движен товар", "движен товар", "товар кыймыл", "кыймыл"] },
  receiving: { href: "/inventory/receiving", permission: "viewInventory", labels: { en: "Receiving documents", ru: "Оприходование", kg: "Кабыл алуу документтери" }, keywords: ["receiving", "receiving document", "goods receipt", "приемк", "поступлен", "оприходован", "документ приемк", "приходные накладные", "кабыл алуу", "киреше накладной"] },
  transfers: { href: "/inventory/transfers", permission: "viewInventory", labels: { en: "Transfer documents", ru: "Документы перемещения", kg: "Которуу документтери" }, keywords: ["transfer", "stock transfer", "перемещен", "документ перемещен", "которуу", "өткөрүү документ"] },
  write_offs: { href: "/inventory/write-offs", permission: "viewInventory", labels: { en: "Write-off documents", ru: "Документы списания", kg: "Эсептен чыгаруу документтери" }, keywords: ["write off", "writeoff", "списан", "документ списан", "эсептен чыгаруу"] },
  stock_counts: { href: "/inventory/counts", permission: "viewInventory", features: ["stockCounts"], labels: { en: "Stock counts", ru: "Инвентаризации", kg: "Инвентаризациялар" }, keywords: ["stock count", "inventory count", "stocktake", "инвентаризац", "инвентаризация", "кампаны саноо"] },
  sales_orders: { href: "/sales/orders", permission: "viewSales", features: ["customerOrders"], labels: { en: "Customer orders and history", ru: "Заказы клиентов и история", kg: "Кардарлардын буйрутмалары жана тарыхы" }, keywords: ["sales order", "customer order", "order history", "заказ клиент", "заказы клиент", "история заказ", "заказ", "кардар буйрутма", "буйрутма"] },
  order_metrics: { href: "/sales/orders/metrics", permission: "viewReports", features: ["customerOrders"], labels: { en: "Order metrics", ru: "Метрики заказов", kg: "Буйрутмалардын көрсөткүчтөрү" }, keywords: ["order metric", "order analytics", "метрик заказ", "аналитика заказ", "буйрутма көрсөткүч"] },
  purchase_orders: { href: "/purchase-orders", permission: "viewPurchaseOrders", labels: { en: "Purchase orders", ru: "Заказы поставщикам", kg: "Жеткирүүчүлөргө буйрутмалар" }, keywords: ["purchase order", "purchasing", "закупк", "заказ поставщик", "заказы поставщик", "жеткирүүчү буйрутма", "сатып алуу"] },
  reports: { href: "/reports", permission: "viewReports", features: ["analytics"], labels: { en: "Reports", ru: "Отчёты", kg: "Отчёттор" }, keywords: ["report", "отчет", "отчёт", "отчеттор"] },
  analytics: { href: "/reports/analytics", permission: "viewReports", features: ["analytics"], labels: { en: "Sales analytics and product rankings", ru: "Аналитика продаж и рейтинг товаров", kg: "Сатуулардын аналитикасы жана товарлардын рейтинги" }, keywords: ["analytics", "sales analytics", "product ranking", "top products", "best sellers", "аналитик", "аналитика продаж", "рейтинг товар", "топ товар", "товар рейтинг", "сатуу аналитик"] },
  exports: { href: "/reports/exports", permission: "viewReports", features: ["exports"], labels: { en: "Exports and download history", ru: "Экспорты и история выгрузок", kg: "Экспорт жана жүктөөлөрдүн тарыхы" }, keywords: ["export", "download history", "экспорт", "выгрузк", "история выгрузок", "жүктөө тарых"] },
  period_close: { href: "/reports/close", permission: "viewReports", features: ["periodClose"], labels: { en: "Period closing history", ru: "История закрытия периодов", kg: "Мезгилдерди жабуу тарыхы" }, keywords: ["period clos", "closing history", "закрыти период", "закрытие период", "мезгил жабуу"] },
  imports: { href: "/settings/import", permission: "manageImports", features: ["imports"], labels: { en: "Import products and customers", ru: "Импорт товаров и клиентов", kg: "Товарларды жана кардарларды импорттоо" }, keywords: ["import", "import history", "csv import", "spreadsheet import", "product import", "customer import", "import product", "import customer", "импорт", "импорт товар", "импорт клиент", "загрузка товар", "импорттоо"] },
  categories: { href: "/settings/categories", permission: "manageProducts", labels: { en: "Product categories", ru: "Категории товаров", kg: "Товар категориялары" }, keywords: ["categor", "product categor", "категор", "категории товар", "товар категория"] },
  attributes: { href: "/settings/attributes", permission: "manageProducts", labels: { en: "Product attributes", ru: "Атрибуты товаров", kg: "Товар атрибуттары" }, keywords: ["attribute", "product attribute", "атрибут", "характеристик", "товар атрибут"] },
  units: { href: "/settings/units", permission: "manageProducts", labels: { en: "Units of measure", ru: "Единицы измерения", kg: "Өлчөө бирдиктери" }, keywords: ["unit", "measurement", "единиц измерен", "единицы измерен", "өлчөө бирдик"] },
  store_groups: { href: "/settings/store-groups", permission: "manageSettings", labels: { en: "Store groups", ru: "Группы магазинов", kg: "Дүкөн топтору" }, keywords: ["store group", "групп магазин", "группы магазин", "дүкөн топ"] },
  users: { href: "/settings/users", permission: "manageUsers", labels: { en: "Users and access", ru: "Пользователи и доступ", kg: "Колдонуучулар жана жеткиликтүүлүк" }, keywords: ["user", "team access", "employee", "пользоват", "сотрудник", "колдонуучу", "кызматкер"] },
  printing: { href: "/settings/printing", permission: "managePrinting", labels: { en: "Printing settings", ru: "Настройки печати", kg: "Басып чыгаруу жөндөөлөрү" }, keywords: ["printing", "printer settings", "label settings", "настройки печат", "печать", "принтер", "басып чыгаруу"] },
  integrations: { href: "/operations/integrations", permission: "manageIntegrations", labels: { en: "Integrations", ru: "Интеграции", kg: "Интеграциялар" }, keywords: ["integration", "marketplace", "интеграц", "маркетплейс", "интеграция"] },
  email_marketing: { href: "/operations/integrations/email-marketing", permission: "manageIntegrations", labels: { en: "Email marketing", ru: "Email-маркетинг", kg: "Email-маркетинг" }, keywords: ["email marketing", "email campaign", "campaign", "рассылк", "email маркетинг", "кат жөнөтүү"] },
  image_studio: { href: "/operations/integrations/product-image-studio", permission: "manageIntegrations", labels: { en: "Product image studio", ru: "Фотостудия товаров", kg: "Товарлардын фотостудиясы" }, keywords: ["image studio", "product image", "photo studio", "фотостуди", "фото товар", "товар сүрөт"] },
  billing: { href: "/billing", permission: "manageBilling", labels: { en: "Subscription and billing", ru: "Подписка и оплата", kg: "Жазылуу жана төлөм" }, keywords: ["billing", "subscription", "plan settings", "подписк", "тариф", "жазылуу", "тарифтер"] },
  jobs: { href: "/admin/jobs", permission: "viewSystem", labels: { en: "Background jobs", ru: "Фоновые задания", kg: "Фондук тапшырмалар" }, keywords: ["background job", "failed job", "job queue", "фоновые задан", "очередь задан", "фондук тапшырма"] },
  system_metrics: { href: "/admin/metrics", permission: "viewSystem", labels: { en: "System metrics", ru: "Системные метрики", kg: "Системанын көрсөткүчтөрү" }, keywords: ["system metric", "system health", "системные метрик", "метрики систем", "система көрсөткүч"] },
  support: { href: "/admin/support", permission: "viewSupport", features: ["supportToolkit"], labels: { en: "Support toolkit", ru: "Инструменты поддержки", kg: "Колдоо куралдары" }, keywords: ["support toolkit", "support tools", "инструмент поддержк", "инструменты поддержк", "колдоо курал"] },
  diagnostics: { href: "/settings/diagnostics", permission: "viewDiagnostics", labels: { en: "Diagnostics", ru: "Диагностика", kg: "Диагностика" }, keywords: ["diagnostic", "диагностик"] },
  profile: { href: "/settings/profile", permission: "viewProfile", labels: { en: "My profile", ru: "Мой профиль", kg: "Менин профилим" }, keywords: ["profile", "my account", "профил", "менин профил"] },
  help: { href: "/help", permission: "viewHelp", labels: { en: "Help and guides", ru: "Помощь и инструкции", kg: "Жардам жана нускамалар" }, keywords: ["help", "guide", "documentation", "помощь", "инструкц", "справк", "жардам", "нускама"] },
  dashboard: { href: "/dashboard", permission: "viewDashboard", labels: { en: "Dashboard", ru: "Обзор", kg: "Сереп" }, keywords: ["dashboard", "overview page", "главная страниц", "обзор", "сереп"] },
  baam: { href: "/baam", permission: "viewReports", features: ["analytics"], labels: { en: "BAAM workspace", ru: "Рабочая область BAAM", kg: "BAAM иш мейкиндиги" }, keywords: ["baam workspace", "baam", "баам"] },
} as const satisfies Record<string, Destination>;

export type BaamDestinationId = keyof typeof destinations;
export const BAAM_DESTINATION_IDS = Object.keys(destinations) as BaamDestinationId[];
export type BaamNavigationAction = { id: BaamDestinationId; label: string; href: string };
export type BaamNavigationContext = {
  access: RoleAccess;
  /** Current authorized organization features, not flags supplied by a model. */
  planFeatures?: readonly string[];
  locale?: BaamNavigationLocale;
  pathname?: string | null;
};

export function getBaamNavigationDestination(id: string, context: BaamNavigationContext): BaamNavigationAction | null {
  if (!Object.prototype.hasOwnProperty.call(destinations, id)) return null;
  if (!["ADMIN", "MANAGER", "STAFF", "CASHIER"].includes(context.access.role ?? "")) return null;
  const destination: Destination = destinations[id as BaamDestinationId];
  if (!hasPermission(context.access, destination.permission) || !canAccessAppRoute(destination.href, context.access)) return null;
  if (destination.roles && !destination.roles.includes(context.access.role as AppRole)) return null;
  if (destination.features?.some((feature) => !context.planFeatures?.includes(feature))) return null;
  return { id: id as BaamDestinationId, label: destination.labels[context.locale ?? "en"], href: destination.href };
}

function canonicalPath(pathname?: string | null) {
  if (!pathname?.startsWith("/") || pathname.startsWith("//") || pathname.includes("\\")) return "";
  return pathname.split(/[?#]/, 1)[0].replace(/^\/(en|ru|kg)(?=\/|$)/, "").replace(/\/+$/, "") || "/";
}

export function resolveBaamPageContext(pathname?: string | null): BaamPageContext {
  const path = canonicalPath(pathname);
  const contexts: Array<[string, BaamPageContext]> = [
    ["/products", "products"], ["/customers", "customers"], ["/suppliers", "suppliers"], ["/stores", "stores"],
    ["/inventory", "inventory"], ["/sales/orders", "sales"], ["/orders", "sales"], ["/reports", "reports"],
    ["/settings/import", "imports"], ["/operations/integrations", "integrations"], ["/settings", "settings"],
    ["/billing", "billing"], ["/help", "support"], ["/admin/support", "support"], ["/baam", "baam"], ["/dashboard", "dashboard"],
  ];
  return contexts.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] ?? "unknown";
}

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const tokensMatch = (word: string, keyword: string) => word === keyword || (keyword.length >= 4 && word.startsWith(keyword));
const phrasesMatch = (tokens: string[], phrase: string) => {
  const words = normalize(phrase).split(" ");
  return tokens.some((_, index) => words.every((word, offset) => tokensMatch(tokens[index + offset] ?? "", word)));
};

function rankedDestinations(message: string, context: BaamNavigationContext) {
  const tokens = normalize(message).split(" ");
  return BAAM_DESTINATION_IDS.flatMap((id) => {
    const action = getBaamNavigationDestination(id, context);
    if (!action) return [];
    const entry = destinations[id];
    const matching = [...entry.keywords, ...Object.values(entry.labels)].filter((phrase) => phrasesMatch(tokens, phrase));
    const score = Math.max(0, ...matching.map((phrase) => normalize(phrase).split(" ").length * 10));
    return score ? [{ action, score, matching }] : [];
  }).sort((a, b) => b.score - a.score);
}

const navigationPhrases = ["open", "show", "see", "navigate", "go to", "take me to", "bring me to", "find", "where is", "where are", "where can i", "открой", "открыть", "покажи", "показать", "посмотреть", "перейди", "перейти", "найди", "найти", "где", "ач", "ачып", "ачуу", "көрсөт", "көргүм", "тап", "кайдан"];
const analysisPhrases = ["how much", "how many", "calculate", "compare", "why", "revenue", "profit", "total", "average", "percent", "sold", "lowest", "highest", "balance owed", "сколько", "посчитай", "рассчитай", "сравни", "почему", "выручк", "прибыл", "сумм", "средн", "процент", "продано", "канча", "эсепте", "салыштыр", "эмне үчүн", "киреше", "пайда"];
const pagePhrases = ["page", "screen", "section", "list", "catalog", "document", "history", "report", "страниц", "раздел", "список", "каталог", "документ", "истори", "отчет", "барак", "тизме", "документ", "тарых"];
const directNavigationPhrases = ["open", "navigate", "go to", "take me to", "bring me to", "where is", "where are", "where can i", "открой", "открыть", "перейди", "перейти", "где", "ач", "ачып", "ачуу", "кайдан"];
const recordDestinations = new Set<BaamDestinationId>(["products", "customers", "suppliers", "stores", "sales_orders", "purchase_orders"]);
const navigationFillers = normalize("open show see want like would navigate go to take me bring find where is are can you i the a an all my please for and of открыть открой покажи показать посмотреть хочу перейди перейти найди найти где мне все мои пожалуйста список ач ачып ачуу көрсөт көргүм келет бер берчи тап кайдан мага бардык сураныч жана").split(" ");

/** Pure intent routing. Analytical or named-record requests stay with verified tools. */
export function matchBaamNavigationIntent(context: BaamNavigationContext & { message: string }): BaamNavigationAction[] {
  const message = context.message;
  if (!message.trim() || message.length > 1500) return [];
  const tokens = normalize(message).split(" ");
  if (["do not", "don t", "не открывай", "не показывай", "ачпа", "көрсөтпө"].some((phrase) => phrasesMatch(tokens, phrase))) return [];
  // Numbers/quoted identifiers can refer to a record or a quantitative request.
  // Kyrgyz эсепте (calculate) must not match эсептен (as in write-off documents).
  const requestsAnalysis = analysisPhrases.some((phrase) => phrase === "эсепте" ? tokens.includes(phrase) : phrasesMatch(tokens, phrase));
  if (/[\p{N}"«»“”`]/u.test(message) || /'[^']+'/.test(message) || /https?:\/\/|javascript:|data:/i.test(message) || requestsAnalysis) return [];
  const directNavigation = directNavigationPhrases.some((phrase) => phrasesMatch(tokens, phrase));
  if (!directNavigation && !pagePhrases.some((phrase) => phrasesMatch(tokens, phrase)) && ["top products", "best sellers", "рейтинг", "топ", "товар рейтинг"].some((phrase) => phrasesMatch(tokens, phrase))) return [];
  const ranked = rankedDestinations(message, context);
  if (!ranked.length) return [];
  const hasNavigationVerb = navigationPhrases.some((phrase) => phrasesMatch(tokens, phrase));
  const bareDestination = ranked.some(({ matching }) => matching.some((phrase) => normalize(phrase) === normalize(message)));
  if (!hasNavigationVerb && !bareDestination) return [];
  if (!hasNavigationVerb && ["top products", "best sellers", "рейтинг", "топ"].some((phrase) => phrasesMatch(tokens, phrase))) return [];
  const bestScore = ranked[0].score;
  const selected = ranked.filter(({ score }) => score >= bestScore * 0.65);
  // Do not turn "find customer Alice" into a generic Customers link.
  if (selected.some(({ action }) => recordDestinations.has(action.id)) && !pagePhrases.some((phrase) => phrasesMatch(tokens, phrase))) {
    const knownWords = selected.flatMap(({ matching }) => matching.flatMap((phrase) => normalize(phrase).split(" ")));
    if (tokens.some((token) => !navigationFillers.some((word) => tokensMatch(token, word)) && !knownWords.some((word) => tokensMatch(token, word)))) return [];
  }
  return selected.slice(0, 4).map(({ action }) => action);
}

const contextualDestinations: Record<BaamPageContext, readonly BaamDestinationId[]> = {
  products: ["movements", "analytics", "imports", "categories", "attributes", "suppliers"],
  customers: ["sales_orders", "imports", "email_marketing", "analytics"],
  suppliers: ["purchase_orders", "receiving", "products"],
  stores: ["inventory", "analytics", "store_groups", "users"],
  inventory: ["movements", "receiving", "transfers", "write_offs", "stock_counts", "products"],
  sales: ["customers", "order_metrics", "analytics", "products", "exports"],
  reports: ["analytics", "exports", "period_close", "products", "movements"],
  imports: ["products", "customers", "categories", "suppliers"],
  integrations: ["email_marketing", "image_studio", "products", "customers"],
  settings: ["profile", "users", "stores", "printing", "imports", "help"],
  billing: ["help", "stores", "users", "profile"],
  support: ["help", "support", "diagnostics", "profile"],
  baam: ["analytics", "products", "customers", "receiving", "reports", "help"],
  dashboard: ["analytics", "products", "customers", "inventory", "reports", "help"],
  unknown: ["products", "customers", "reports", "stores", "help"],
};

export function suggestBaamDestinations(context: BaamNavigationContext & { topic?: string; limit?: number }): BaamNavigationAction[] {
  const limit = Math.max(0, Math.min(6, Number.isFinite(context.limit) ? Math.floor(context.limit!) : 4));
  const currentPath = canonicalPath(context.pathname);
  const topical = context.topic ? rankedDestinations(context.topic.slice(0, 200), context).map(({ action }) => action.id) : [];
  const candidates = [...new Set([...topical, ...contextualDestinations[resolveBaamPageContext(context.pathname)]])];
  return candidates.flatMap((id) => {
    const action = getBaamNavigationDestination(id, context);
    return action && action.href !== currentPath ? [action] : [];
  }).slice(0, limit);
}
