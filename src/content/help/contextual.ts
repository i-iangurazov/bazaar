export const contextualHelpRoutes = [
  { match: /^\/products(?:\/|$)/, guideId: "products/add-product" },
  { match: /^\/settings\/import(?:\/|$)/, guideId: "products/import-products" },
  { match: /^\/inventory\/receiving(?:\/|$)/, guideId: "inventory/receiving" },
  { match: /^\/inventory\/transfers(?:\/|$)/, guideId: "inventory/transfer" },
  { match: /^\/inventory\/write-offs(?:\/|$)/, guideId: "inventory/write-off" },
  { match: /^\/inventory\/counts(?:\/|$)/, guideId: "inventory/inventory-count" },
  { match: /^\/pos\/sell(?:\/|$)/, guideId: "pos/make-sale" },
  { match: /^\/pos\/history(?:\/|$)/, guideId: "pos/return-sale" },
  { match: /^\/pos\/shifts(?:\/|$)/, guideId: "pos/close-shift" },
  { match: /^\/pos(?:\/|$)/, guideId: "pos/open-shift" },
  { match: /^\/settings\/users(?:\/|$)/, guideId: "settings/add-employee" },
  { match: /^\/stores(?:\/|$)/, guideId: "getting-started/choose-store" },
  { match: /^\/reports\/analytics(?:\/|$)/, guideId: "reports/analytics-basics" },
  { match: /^\/reports(?:\/|$)/, guideId: "reports/export-reports" },
  { match: /^\/operations\/integrations(?:\/|$)/, guideId: "integrations/connect-marketplace" },
] as const;

export const getContextualHelpGuideId = (pathname: string) =>
  contextualHelpRoutes.find((route) => route.match.test(pathname))?.guideId ?? null;

export const getContextualHelpSummary = (pathname: string) => {
  const guideId = getContextualHelpGuideId(pathname);
  return guideId ? (contextualHelpSummaries[guideId] ?? null) : null;
};

export const getContextualHelpHref = (pathname: string) => {
  const guideId = getContextualHelpGuideId(pathname);
  return guideId ? `/help/${guideId}?from=${encodeURIComponent(pathname)}` : null;
};
import { helpText as t } from "./ui";
import type { LocalizedText } from "./types";

type ContextualHelpSummary = { title: LocalizedText; steps: LocalizedText[] };

const contextualHelpSummaries: Record<string, ContextualHelpSummary> = {
  "products/add-product": {
    title: t("Товары", "Товарлар", "Products"),
    steps: [
      t("Найдите или добавьте товар", "Товарды табыңыз же кошуңуз", "Find or add a product"),
      t("Проверьте цену и магазин", "Бааны жана дүкөндү текшериңиз", "Verify price and store"),
      t("Заполните SKU или штрихкод", "SKU же штрихкодду толтуруңуз", "Add SKU or barcode"),
      t("Сохраните карточку", "Карточканы сактаңыз", "Save the product"),
    ],
  },
  "products/import-products": {
    title: t("Импорт товаров", "Товарларды импорттоо", "Product import"),
    steps: [
      t("Загрузите Excel или CSV", "Excel же CSV жүктөңүз", "Upload Excel or CSV"),
      t("Сопоставьте колонки", "Мамычаларды дал келтириңиз", "Map columns"),
      t("Исправьте ошибки", "Каталарды оңдоңуз", "Fix validation errors"),
      t("Запустите импорт", "Импортту баштаңыз", "Run import"),
    ],
  },
  "inventory/receiving": {
    title: t("Оприходование", "Кириштөө", "Receiving"),
    steps: [
      t("Выберите магазин", "Дүкөндү тандаңыз", "Choose the store"),
      t("Добавьте товары", "Товарларды кошуңуз", "Add products"),
      t(
        "Укажите количество и себестоимость",
        "Санын жана өздүк наркын көрсөтүңүз",
        "Enter quantity and cost",
      ),
      t("Нажмите «Провести»", "«Өткөрүү» баскычын басыңыз", "Select Post"),
    ],
  },
  "inventory/transfer": {
    title: t("Перемещение", "Которуу", "Transfer"),
    steps: [
      t("Выберите откуда и куда", "Кайдан жана кайда тандаңыз", "Choose source and destination"),
      t("Добавьте товары", "Товарларды кошуңуз", "Add products"),
      t("Введите количество", "Санын киргизиңиз", "Enter quantity"),
      t("Проведите документ", "Документти өткөрүңүз", "Post the document"),
    ],
  },
  "inventory/write-off": {
    title: t("Списание", "Эсептен чыгаруу", "Write-off"),
    steps: [
      t("Выберите магазин", "Дүкөндү тандаңыз", "Choose the store"),
      t("Добавьте позиции", "Позицияларды кошуңуз", "Add items"),
      t("Укажите причину", "Себебин жазыңыз", "Add a reason"),
      t("Проведите документ", "Документти өткөрүңүз", "Post the document"),
    ],
  },
  "inventory/inventory-count": {
    title: t("Инвентаризация", "Инвентаризация", "Inventory count"),
    steps: [
      t("Создайте пересчёт", "Кайра саноону түзүңүз", "Create a count"),
      t("Посчитайте фактический товар", "Чыныгы товарды санаңыз", "Count physical stock"),
      t("Проверьте расхождения", "Айырмаларды текшериңиз", "Review differences"),
      t("Примените результат", "Жыйынтыкты колдонуңуз", "Apply the result"),
    ],
  },
  "pos/open-shift": {
    title: t("Открытие смены", "Сменаны ачуу", "Open shift"),
    steps: [
      t("Выберите кассу", "Кассаны тандаңыз", "Choose a register"),
      t("Введите начальную сумму", "Баштапкы сумманы киргизиңиз", "Enter opening cash"),
      t("Проверьте сотрудника", "Кызматкерди текшериңиз", "Verify the cashier"),
      t("Откройте смену", "Сменаны ачыңыз", "Open the shift"),
    ],
  },
  "pos/make-sale": {
    title: t("Продажа на кассе", "Кассада сатуу", "POS sale"),
    steps: [
      t("Добавьте товар", "Товарды кошуңуз", "Add a product"),
      t("Проверьте корзину", "Себетти текшериңиз", "Review the cart"),
      t("Выберите оплату", "Төлөмдү тандаңыз", "Choose payment"),
      t("Завершите чек", "Чекти бүтүрүңүз", "Complete the receipt"),
    ],
  },
  "pos/return-sale": {
    title: t("Возврат", "Кайтаруу", "Return"),
    steps: [
      t("Найдите исходный чек", "Баштапкы чекти табыңыз", "Find the original receipt"),
      t("Выберите товары", "Товарларды тандаңыз", "Choose items"),
      t("Укажите количество", "Санын көрсөтүңүз", "Enter quantity"),
      t("Подтвердите возврат", "Кайтарууну ырастаңыз", "Confirm the return"),
    ],
  },
  "pos/close-shift": {
    title: t("Закрытие смены", "Сменаны жабуу", "Close shift"),
    steps: [
      t("Завершите открытые чеки", "Ачык чектерди бүтүрүңүз", "Resolve open receipts"),
      t("Посчитайте наличные", "Накталай акчаны санаңыз", "Count cash"),
      t("Сверьте расхождение", "Айырманы текшериңиз", "Review the variance"),
      t("Закройте смену", "Сменаны жабыңыз", "Close the shift"),
    ],
  },
  "settings/add-employee": {
    title: t("Сотрудники", "Кызматкерлер", "Employees"),
    steps: [
      t("Введите рабочий email", "Жумуш email'ин киргизиңиз", "Enter work email"),
      t("Выберите роль", "Ролду тандаңыз", "Choose a role"),
      t("Назначьте магазины", "Дүкөндөрдү дайындаңыз", "Assign stores"),
      t("Отправьте приглашение", "Чакырууну жөнөтүңүз", "Send the invitation"),
    ],
  },
  "reports/analytics-basics": {
    title: t("Аналитика", "Аналитика", "Analytics"),
    steps: [
      t("Выберите период", "Мезгилди тандаңыз", "Choose a period"),
      t("Проверьте выручку", "Кирешени текшериңиз", "Review revenue"),
      t("Посмотрите маржу", "Маржаны караңыз", "Review margin"),
      t("Сравните магазины", "Дүкөндөрдү салыштырыңыз", "Compare stores"),
    ],
  },
  "reports/export-reports": {
    title: t("Отчёты", "Отчёттор", "Reports"),
    steps: [
      t("Выберите отчёт", "Отчётту тандаңыз", "Choose a report"),
      t("Задайте фильтры", "Фильтрлерди коюңуз", "Set filters"),
      t("Проверьте таблицу", "Таблицаны текшериңиз", "Review the table"),
      t("Нажмите «Экспорт»", "«Экспорт» баскычын басыңыз", "Select Export"),
    ],
  },
  "getting-started/choose-store": {
    title: t("Магазины", "Дүкөндөр", "Stores"),
    steps: [
      t("Откройте список магазинов", "Дүкөндөрдүн тизмесин ачыңыз", "Open the store list"),
      t(
        "Выберите или создайте точку",
        "Чекитти тандаңыз же түзүңүз",
        "Choose or create a location",
      ),
      t("Проверьте сотрудников", "Кызматкерлерди текшериңиз", "Check staff access"),
      t("Проверьте активный магазин", "Активдүү дүкөндү текшериңиз", "Verify the active store"),
    ],
  },
  "integrations/connect-marketplace": {
    title: t("Интеграции", "Интеграциялар", "Integrations"),
    steps: [
      t("Выберите канал", "Каналды тандаңыз", "Choose a channel"),
      t("Проверьте магазин", "Дүкөндү текшериңиз", "Verify the store"),
      t("Исправьте обязательные данные", "Милдеттүү маалыматтарды оңдоңуз", "Fix required data"),
      t("Запустите проверку", "Текшерүүнү баштаңыз", "Run validation"),
    ],
  },
};
