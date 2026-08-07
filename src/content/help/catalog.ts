import { helpText as t } from "./ui";
import type {
  HelpAnnotation,
  HelpCategory,
  HelpCategorySlug,
  HelpGuide,
  HelpJourneyItem,
  HelpMedia,
  HelpRoleTrack,
  HelpStep,
  HelpTask,
  LocalizedText,
} from "./types";

const captures = {
  products: "/marketing/captures/products.webp",
  movements: "/marketing/captures/movements.webp",
  posDesktop: "/marketing/captures/pos-desktop.webp",
  posMobile: "/marketing/captures/pos-mobile.webp",
  dashboard: "/marketing/captures/dashboard.webp",
  integrations: "/marketing/captures/integrations.webp",
} as const;

const annotation = (
  number: number,
  x: number,
  y: number,
  label: LocalizedText,
  width?: number,
  height?: number,
): HelpAnnotation => ({ number, x, y, label, width, height });

const media = (
  src: string,
  alt: LocalizedText,
  annotations: HelpAnnotation[],
  mobileSrc?: string,
): HelpMedia => ({ src, mobileSrc, alt, annotations });

const step = (
  title: LocalizedText,
  body: LocalizedText,
  options: Pick<HelpStep, "checklist" | "note" | "media"> = {},
): HelpStep => ({ title, body, ...options });

const guide = (value: HelpGuide) => value;

const productScreen = (label: LocalizedText, x = 83, y = 13) =>
  media(
    captures.products,
    t("Список товаров Bazaar", "Bazaar товарларынын тизмеси", "Bazaar product list"),
    [annotation(1, x, y, label, 14, 9)],
  );

const movementScreen = (label: LocalizedText, x = 24, y = 24) =>
  media(
    captures.movements,
    t(
      "Журнал движений товаров Bazaar",
      "Bazaar товар кыймылы журналы",
      "Bazaar product movement journal",
    ),
    [annotation(1, x, y, label, 23, 9)],
  );

const posScreen = (label: LocalizedText, x = 72, y = 34, mobile = false) =>
  media(
    mobile ? captures.posMobile : captures.posDesktop,
    mobile
      ? t("Мобильная касса Bazaar", "Bazaar мобилдик кассасы", "Bazaar mobile POS")
      : t("Касса Bazaar на компьютере", "Компьютердеги Bazaar кассасы", "Bazaar desktop POS"),
    [annotation(1, x, y, label, mobile ? 28 : 20, 9)],
    mobile ? undefined : captures.posMobile,
  );

const dashboardScreen = (label: LocalizedText, x = 31, y = 30) =>
  media(
    captures.dashboard,
    t("Панель аналитики Bazaar", "Bazaar аналитика панели", "Bazaar analytics dashboard"),
    [annotation(1, x, y, label, 22, 10)],
  );

const integrationScreen = (label: LocalizedText, x = 26, y = 28) =>
  media(
    captures.integrations,
    t("Интеграции Bazaar", "Bazaar интеграциялары", "Bazaar integrations"),
    [annotation(1, x, y, label, 22, 10)],
  );

export const helpCategories: HelpCategory[] = [
  {
    slug: "getting-started",
    title: t("Начало работы", "Ишти баштоо", "Getting started"),
    description: t(
      "Короткий путь до первой продажи.",
      "Биринчи сатууга чейинки кыска жол.",
      "A short path to your first sale.",
    ),
    icon: "rocket",
  },
  {
    slug: "pos",
    title: t("POS / Касса", "POS / Касса", "POS"),
    description: t(
      "Смена, продажа, оплата и возврат.",
      "Смена, сатуу, төлөм жана кайтаруу.",
      "Shifts, sales, payments, and returns.",
    ),
    icon: "register",
  },
  {
    slug: "products",
    title: t("Товары", "Товарлар", "Products"),
    description: t(
      "Карточки, цены, варианты и импорт.",
      "Карточкалар, баалар, варианттар жана импорт.",
      "Catalog, pricing, variants, and import.",
    ),
    icon: "products",
  },
  {
    slug: "inventory",
    title: t("Склад", "Кампа", "Inventory"),
    description: t(
      "Остатки и все движения товара.",
      "Калдыктар жана товарлардын кыймылы.",
      "Stock and every inventory movement.",
    ),
    icon: "inventory",
  },
  {
    slug: "orders",
    title: t("Заказы и клиенты", "Буйрутмалар жана кардарлар", "Orders & customers"),
    description: t(
      "Статусы, отмены и история клиента.",
      "Статустар, жокко чыгаруу жана кардардын тарыхы.",
      "Statuses, cancellations, and customer history.",
    ),
    icon: "orders",
  },
  {
    slug: "reports",
    title: t("Аналитика и отчёты", "Аналитика жана отчёттор", "Analytics & reports"),
    description: t(
      "Продажи, остатки, маржа и экспорт.",
      "Сатуулар, калдыктар, маржа жана экспорт.",
      "Sales, stock, margin, and exports.",
    ),
    icon: "reports",
  },
  {
    slug: "integrations",
    title: t("Интеграции", "Интеграциялар", "Integrations"),
    description: t(
      "Маркетплейсы, API и коммуникации.",
      "Маркетплейстер, API жана байланыш.",
      "Marketplaces, API, and communication.",
    ),
    icon: "integrations",
  },
  {
    slug: "settings",
    title: t("Настройки", "Жөндөөлөр", "Settings"),
    description: t(
      "Магазины, сотрудники и права.",
      "Дүкөндөр, кызматкерлер жана укуктар.",
      "Stores, employees, and permissions.",
    ),
    icon: "settings",
  },
];

export const helpGuides: HelpGuide[] = [
  guide({
    slug: "add-product",
    category: "products",
    title: t("Как добавить товар", "Товарды кантип кошуу керек", "How to add a product"),
    summary: t(
      "Создайте карточку товара, которую можно продавать и учитывать на складе.",
      "Сатууга жана кампада эсепке алууга боло турган товар карточкасын түзүңүз.",
      "Create a product that can be sold and tracked in inventory.",
    ),
    keywords: t(
      "товар карточка название цена фото sku штрихкод",
      "товар карточка аталыш баа сүрөт sku штрихкод",
      "product item create title price photo sku barcode",
    ),
    aliases: t(
      "завести товар новый товар создать позицию",
      "жаңы товар ачуу позиция кошуу",
      "new item add item create stock item",
    ),
    roles: ["owner", "manager", "stockkeeper"],
    estimatedMinutes: 3,
    appRoute: "/products/new",
    steps: [
      step(
        t("Откройте «Товары»", "«Товарлар» бөлүмүн ачыңыз", "Open Products"),
        t(
          "В боковом меню выберите «Товары».",
          "Каптал менюдан «Товарлар» тандаңыз.",
          "Choose Products in the side menu.",
        ),
      ),
      step(
        t("Нажмите «Добавить товар»", "«Товар кошуу» баскычын басыңыз", "Select Add product"),
        t(
          "Кнопка находится справа вверху списка.",
          "Баскыч тизменин оң жогору жагында.",
          "The button is at the top-right of the list.",
        ),
        { media: productScreen(t("Добавить товар", "Товар кошуу", "Add product")) },
      ),
      step(
        t("Заполните главное", "Негизги маалыматты толтуруңуз", "Enter the essentials"),
        t(
          "Остальные поля можно дополнить позже.",
          "Башка талааларды кийин толтурсаңыз болот.",
          "You can complete the other fields later.",
        ),
        {
          checklist: [
            t("Название — обязательно", "Аталышы — милдеттүү", "Title — required"),
            t("Цена — обязательно", "Баасы — милдеттүү", "Price — required"),
            t("Фото — желательно", "Сүрөт — сунушталат", "Photo — recommended"),
            t(
              "SKU и штрихкод — можно позже",
              "SKU жана штрихкод — кийин болот",
              "SKU and barcode — can be added later",
            ),
          ],
        },
      ),
      step(
        t("Сохраните", "Сактаңыз", "Save"),
        t(
          "Проверьте магазин и нажмите «Сохранить».",
          "Дүкөндү текшерип, «Сактоо» баскычын басыңыз.",
          "Check the store and select Save.",
        ),
      ),
    ],
    success: t(
      "Товар появился в каталоге.",
      "Товар каталогдо пайда болду.",
      "The product now appears in the catalog.",
    ),
    relatedGuides: [
      "inventory/receiving",
      "products/edit-product",
      "products/import-products",
      "pos/make-sale",
    ],
    troubleshooting: [
      {
        question: t("Кнопки добавления нет?", "Кошуу баскычы жокпу?", "No add button?"),
        answer: t(
          "Проверьте право на управление товарами или попросите владельца.",
          "Товарларды башкаруу укугун текшериңиз же ээсине кайрылыңыз.",
          "Check your product-management permission or ask the owner.",
        ),
      },
    ],
  }),
  guide({
    slug: "edit-product",
    category: "products",
    title: t("Как изменить товар", "Товарды кантип өзгөртүү керек", "How to edit a product"),
    summary: t(
      "Обновите название, цену, фото или штрихкод без создания дубля.",
      "Кайталанма товар түзбөстөн аталышын, баасын, сүрөтүн же штрихкодун жаңыртыңыз.",
      "Update title, price, photo, or barcode without creating a duplicate.",
    ),
    keywords: t(
      "редактировать изменить цена название фото штрихкод",
      "өзгөртүү баа аталыш сүрөт штрихкод",
      "edit update price title image barcode",
    ),
    aliases: t(
      "поменять товар исправить карточку новая цена",
      "товарды оңдоо жаңы баа",
      "change item fix product new price",
    ),
    roles: ["owner", "manager"],
    estimatedMinutes: 3,
    appRoute: "/products",
    steps: [
      step(
        t("Найдите товар", "Товарды табыңыз", "Find the product"),
        t(
          "Ищите по названию, SKU или штрихкоду.",
          "Аталышы, SKU же штрихкод боюнча издеңиз.",
          "Search by title, SKU, or barcode.",
        ),
        {
          media: productScreen(
            t("Поиск по каталогу", "Каталог боюнча издөө", "Catalog search"),
            36,
            22,
          ),
        },
      ),
      step(
        t("Откройте карточку", "Карточканы ачыңыз", "Open the product"),
        t(
          "Нажмите строку товара или действие «Изменить».",
          "Товар сабын же «Өзгөртүү» аракетин басыңыз.",
          "Select the product row or Edit action.",
        ),
      ),
      step(
        t("Измените нужные поля", "Керектүү талааларды өзгөртүңүз", "Update the fields"),
        t(
          "Не меняйте SKU и штрихкод без необходимости — по ним товар ищут на кассе.",
          "Зарыл болбосо SKU жана штрихкодду өзгөртпөңүз — касса алар боюнча издейт.",
          "Avoid changing SKU and barcode unless needed; POS search uses them.",
        ),
      ),
      step(
        t("Сохраните", "Сактаңыз", "Save"),
        t(
          "Новая карточка сразу станет доступна в выбранных магазинах.",
          "Жаңы карточка тандалган дүкөндөрдө дароо жеткиликтүү болот.",
          "The updated product becomes available in its assigned stores.",
        ),
      ),
    ],
    success: t(
      "Изменения сохранены без нового товара.",
      "Өзгөртүүлөр жаңы товар түзбөстөн сакталды.",
      "Changes are saved without creating another product.",
    ),
    relatedGuides: ["products/add-product", "inventory/receiving", "pos/apply-discount"],
  }),
  guide({
    slug: "import-products",
    category: "products",
    title: t(
      "Как импортировать товары",
      "Товарларды кантип импорттоо керек",
      "How to import products",
    ),
    summary: t(
      "Загрузите каталог из Excel и сначала исправьте строки с ошибками.",
      "Каталогду Excel'ден жүктөп, адегенде катасы бар саптарды оңдоңуз.",
      "Upload a catalog from Excel and fix invalid rows first.",
    ),
    keywords: t(
      "excel xlsx csv импорт файл массово товары",
      "excel xlsx csv импорт файл товарлар",
      "excel xlsx csv import file bulk products",
    ),
    aliases: t(
      "загрузить прайс перенести из таблицы много товаров",
      "прайс жүктөө таблицадан көчүрүү көп товар",
      "upload price list migrate spreadsheet many items",
    ),
    roles: ["owner", "manager"],
    estimatedMinutes: 6,
    appRoute: "/settings/import",
    steps: [
      step(
        t("Откройте импорт", "Импортту ачыңыз", "Open import"),
        t(
          "В «Товарах» откройте действия и выберите импорт.",
          "«Товарларда» аракеттерди ачып, импортту тандаңыз.",
          "In Products, open actions and choose import.",
        ),
        {
          media: productScreen(
            t("Действия → Импорт", "Аракеттер → Импорт", "Actions → Import"),
            88,
            18,
          ),
        },
      ),
      step(
        t("Загрузите Excel или CSV", "Excel же CSV жүктөңүз", "Upload Excel or CSV"),
        t(
          "Одна строка должна описывать один товар или вариант.",
          "Бир сап бир товарды же вариантты сүрөттөшү керек.",
          "Each row should describe one product or variant.",
        ),
      ),
      step(
        t("Сопоставьте колонки", "Мамычаларды дал келтириңиз", "Map columns"),
        t(
          "Минимум проверьте название, цену, SKU и штрихкод.",
          "Аталыш, баа, SKU жана штрихкодду текшериңиз.",
          "At minimum, verify title, price, SKU, and barcode.",
        ),
      ),
      step(
        t("Исправьте ошибки", "Каталарды оңдоңуз", "Fix validation errors"),
        t(
          "Импортируйте только после предпросмотра. Неверные строки будут показаны отдельно.",
          "Алдын ала кароодон кийин гана импорттоңуз. Туура эмес саптар өзүнчө көрсөтүлөт.",
          "Import only after preview; invalid rows are shown separately.",
        ),
      ),
      step(
        t("Запустите импорт", "Импортту баштаңыз", "Run import"),
        t(
          "Не закрывайте вкладку до появления результата пакета.",
          "Пакеттин жыйынтыгы чыкканча өтмөктү жаппаңыз.",
          "Keep the tab open until the batch result appears.",
        ),
      ),
    ],
    success: t(
      "Корректные товары добавлены, ошибки сохранены в отчёте.",
      "Туура товарлар кошулду, каталар отчётто сакталды.",
      "Valid products are added and errors remain in the report.",
    ),
    relatedGuides: ["products/add-product", "inventory/receiving", "inventory/inventory-count"],
    troubleshooting: [
      {
        question: t(
          "Импорт сообщает о дубликате?",
          "Импорт кайталанма тууралуу айтып жатабы?",
          "Duplicate warning?",
        ),
        answer: t(
          "Проверьте SKU и штрихкод: внутри организации они должны быть уникальными.",
          "SKU жана штрихкодду текшериңиз: уюм ичинде алар уникалдуу болушу керек.",
          "Check SKU and barcode; they must be unique inside the organization.",
        ),
      },
    ],
  }),
  guide({
    slug: "receiving",
    category: "inventory",
    title: t("Как оприходовать товар", "Товарды кантип кириштөө керек", "How to receive stock"),
    summary: t(
      "Добавьте поступившее количество и фактическую себестоимость.",
      "Келген санды жана чыныгы өздүк наркты кошуңуз.",
      "Add received quantities and actual unit costs.",
    ),
    keywords: t(
      "приемка приход остаток себестоимость поставка",
      "кабыл алуу кириш калдык өздүк нарк",
      "receiving stock cost delivery purchase",
    ),
    aliases: t(
      "добавить остаток пришел товар поступление закупка",
      "калдык кошуу товар келди сатып алуу",
      "add inventory goods arrived restock",
    ),
    roles: ["owner", "manager", "stockkeeper"],
    estimatedMinutes: 4,
    appRoute: "/inventory/receiving",
    steps: [
      step(
        t("Выберите магазин", "Дүкөндү тандаңыз", "Choose the store"),
        t(
          "Остаток увеличится только в выбранной точке.",
          "Калдык тандалган жерде гана көбөйөт.",
          "Stock increases only at the selected location.",
        ),
      ),
      step(
        t("Добавьте товары", "Товарларды кошуңуз", "Add products"),
        t(
          "Найдите товар по названию, SKU или сканируйте штрихкод.",
          "Товарды аталышы, SKU же штрихкод менен табыңыз.",
          "Find products by title, SKU, or barcode.",
        ),
        {
          media: movementScreen(
            t(
              "Проверьте магазин и товар",
              "Дүкөн менен товарды текшериңиз",
              "Verify store and product",
            ),
            24,
            27,
          ),
        },
      ),
      step(
        t(
          "Укажите количество и себестоимость",
          "Санын жана өздүк наркын көрсөтүңүз",
          "Enter quantity and cost",
        ),
        t(
          "Себестоимость — цена одной единицы у поставщика.",
          "Өздүк нарк — жеткирүүчүдөн бир даананын баасы.",
          "Unit cost is the supplier price for one unit.",
        ),
      ),
      step(
        t("Проведите документ", "Документти өткөрүңүз", "Post the document"),
        t(
          "Проверьте итог и нажмите «Провести». Остаток изменится сразу.",
          "Жыйынтыкты текшерип, «Өткөрүү» баскычын басыңыз. Калдык дароо өзгөрөт.",
          "Review the total and select Post. Stock updates immediately.",
        ),
      ),
    ],
    success: t(
      "Остаток и себестоимость обновлены, движение записано.",
      "Калдык жана өздүк нарк жаңырды, кыймыл жазылды.",
      "Stock and cost are updated and the movement is recorded.",
    ),
    relatedGuides: [
      "inventory/transfer",
      "inventory/write-off",
      "inventory/inventory-count",
      "products/add-product",
    ],
    troubleshooting: [
      {
        question: t("Товар не находится?", "Товар табылбай жатабы?", "Cannot find a product?"),
        answer: t(
          "Проверьте выбранный магазин и назначение товара этому магазину.",
          "Тандалган дүкөндү жана товар ошол дүкөнгө дайындалганын текшериңиз.",
          "Check the selected store and that the product is assigned to it.",
        ),
      },
    ],
  }),
  guide({
    slug: "transfer",
    category: "inventory",
    title: t("Как переместить товар", "Товарды кантип которуу керек", "How to transfer stock"),
    summary: t(
      "Перенесите остаток между магазинами одной операцией.",
      "Калдыкты дүкөндөрдүн ортосунда бир операция менен которуңуз.",
      "Move stock between stores in one operation.",
    ),
    keywords: t(
      "перемещение магазин склад отправить получить",
      "которуу дүкөн кампа жөнөтүү алуу",
      "transfer store warehouse source destination",
    ),
    aliases: t(
      "перекинуть товар в другой магазин перевести остаток",
      "товарды башка дүкөнгө жөнөтүү калдык которуу",
      "move items to another store move stock",
    ),
    roles: ["owner", "manager", "stockkeeper"],
    estimatedMinutes: 4,
    appRoute: "/inventory/transfers",
    steps: [
      step(
        t(
          "Выберите откуда и куда",
          "Кайдан жана кайда экенин тандаңыз",
          "Choose source and destination",
        ),
        t(
          "Магазины должны быть разными.",
          "Дүкөндөр ар башка болушу керек.",
          "Source and destination must be different.",
        ),
      ),
      step(
        t("Добавьте товары", "Товарларды кошуңуз", "Add products"),
        t(
          "Bazaar покажет доступный остаток в исходном магазине.",
          "Bazaar баштапкы дүкөндөгү жеткиликтүү калдыкты көрсөтөт.",
          "Bazaar shows available stock at the source.",
        ),
        {
          media: movementScreen(
            t("Источник и получатель", "Булак жана алуучу", "Source and destination"),
            40,
            24,
          ),
        },
      ),
      step(
        t("Введите количество", "Санын киргизиңиз", "Enter quantity"),
        t(
          "Не отправляйте больше, чем реально передаёте.",
          "Чынында өткөргөндөн көп сан киргизбеңиз.",
          "Do not enter more than you physically move.",
        ),
      ),
      step(
        t("Проведите перемещение", "Которууну өткөрүңүз", "Post the transfer"),
        t(
          "Система одновременно уменьшит один остаток и увеличит другой.",
          "Система бир убакта бир калдыкты азайтып, экинчисин көбөйтөт.",
          "The system decreases one location and increases the other atomically.",
        ),
      ),
    ],
    success: t(
      "Парные движения появились в журнале обоих магазинов.",
      "Эки дүкөндүн журналында жуп кыймылдар пайда болду.",
      "Paired movements appear in both stores.",
    ),
    relatedGuides: ["inventory/receiving", "inventory/write-off", "inventory/inventory-count"],
  }),
  guide({
    slug: "write-off",
    category: "inventory",
    title: t("Как списать товар", "Товарды кантип эсептен чыгаруу керек", "How to write off stock"),
    summary: t(
      "Зафиксируйте порчу, потерю или другое уменьшение остатка.",
      "Бузулуу, жоготуу же калдыктын башка азайышын каттаңыз.",
      "Record damage, loss, or another stock decrease.",
    ),
    keywords: t(
      "списание потеря брак порча минус остаток",
      "эсептен чыгаруу жоготуу бузулуу калдык",
      "write off damage loss shrink stock",
    ),
    aliases: t(
      "убрать остаток товар испортился пропал",
      "калдыкты азайтуу товар бузулду жоголду",
      "remove stock item damaged missing",
    ),
    roles: ["owner", "manager", "stockkeeper"],
    estimatedMinutes: 3,
    appRoute: "/inventory/write-offs",
    steps: [
      step(
        t("Выберите магазин", "Дүкөндү тандаңыз", "Choose the store"),
        t(
          "Списание уменьшит остаток только в этой точке.",
          "Эсептен чыгаруу ушул жерде гана калдыкты азайтат.",
          "The write-off affects only this location.",
        ),
      ),
      step(
        t("Добавьте позиции", "Позицияларды кошуңуз", "Add items"),
        t(
          "Укажите товар, вариант и количество.",
          "Товарды, вариантты жана санын көрсөтүңүз.",
          "Choose product, variant, and quantity.",
        ),
        {
          media: movementScreen(
            t("Выберите тип «Списание»", "«Эсептен чыгаруу» түрүн тандаңыз", "Choose Write-off"),
            18,
            35,
          ),
        },
      ),
      step(
        t("Укажите причину", "Себебин жазыңыз", "Add a reason"),
        t(
          "Например: порча, бой, недостача. Это останется в истории.",
          "Мисалы: бузулуу, сынык, жетишпестик. Бул тарыхта калат.",
          "For example: damage, breakage, or shortage. It remains in history.",
        ),
      ),
      step(
        t("Проведите документ", "Документти өткөрүңүз", "Post the document"),
        t(
          "Перед подтверждением ещё раз проверьте количество.",
          "Ырастоодон мурун санын дагы бир жолу текшериңиз.",
          "Check the quantity once more before confirming.",
        ),
      ),
    ],
    success: t(
      "Остаток уменьшен, причина и автор сохранены.",
      "Калдык азайды, себеби жана автору сакталды.",
      "Stock is reduced and the reason and actor are recorded.",
    ),
    relatedGuides: ["inventory/inventory-count", "inventory/receiving", "inventory/transfer"],
  }),
  guide({
    slug: "inventory-count",
    category: "inventory",
    title: t(
      "Как провести инвентаризацию",
      "Инвентаризацияны кантип өткөрүү керек",
      "How to run an inventory count",
    ),
    summary: t(
      "Сверьте фактический товар с остатком Bazaar и примените разницу.",
      "Чыныгы товарды Bazaar калдыгы менен салыштырып, айырманы колдонуңуз.",
      "Compare physical stock with Bazaar and apply the difference.",
    ),
    keywords: t(
      "инвентаризация ревизия пересчет факт остаток сканер",
      "инвентаризация ревизия саноо чыныгы калдык",
      "inventory count stocktake physical count scanner",
    ),
    aliases: t(
      "посчитать магазин сверить остатки ревизия товара",
      "дүкөндү саноо калдыктарды текшерүү",
      "count store reconcile stock stocktake",
    ),
    roles: ["owner", "manager", "stockkeeper"],
    estimatedMinutes: 7,
    appRoute: "/inventory/counts",
    steps: [
      step(
        t("Создайте пересчёт", "Кайра саноону түзүңүз", "Create a count"),
        t(
          "Выберите один магазин и понятное название.",
          "Бир дүкөндү жана түшүнүктүү аталышты тандаңыз.",
          "Choose one store and a clear name.",
        ),
      ),
      step(
        t("Считайте фактический товар", "Чыныгы товарды санаңыз", "Count physical stock"),
        t(
          "Сканируйте штрихкод или найдите товар вручную.",
          "Штрихкодду сканерлеңиз же товарды кол менен табыңыз.",
          "Scan barcodes or find products manually.",
        ),
        {
          media: movementScreen(
            t(
              "Факт сравнивается с учётом",
              "Чыныгы сан эсеп менен салыштырылат",
              "Physical count is compared with records",
            ),
            56,
            38,
          ),
        },
      ),
      step(
        t("Проверьте расхождения", "Айырмаларды текшериңиз", "Review differences"),
        t(
          "Особенно внимательно проверьте большие плюсы и минусы.",
          "Чоң плюс жана минустарды өзгөчө кылдат текшериңиз.",
          "Review large positive and negative differences carefully.",
        ),
      ),
      step(
        t("Примените результат", "Жыйынтыкты колдонуңуз", "Apply the count"),
        t(
          "После применения Bazaar создаст корректировки. Исходные движения не удаляются.",
          "Колдонгондон кийин Bazaar түзөтүүлөрдү жаратат. Баштапкы кыймылдар өчүрүлбөйт.",
          "Bazaar creates adjustments; original movements are never deleted.",
        ),
      ),
    ],
    success: t(
      "Учётный остаток приведён к проверенному факту.",
      "Эсептеги калдык текшерилген чыныгы санга келтирилди.",
      "Recorded stock now matches the verified physical count.",
    ),
    relatedGuides: ["inventory/write-off", "inventory/receiving", "reports/analytics-basics"],
    troubleshooting: [
      {
        question: t("Товар пропущен?", "Товар өтүп кеттиби?", "Missed an item?"),
        answer: t(
          "Не применяйте документ, пока не проверите все пропущенные позиции.",
          "Бардык өтүп кеткен позицияларды текшермейинче документти колдонбоңуз.",
          "Do not apply the count until every missed item is reviewed.",
        ),
      },
    ],
  }),
  guide({
    slug: "open-shift",
    category: "pos",
    title: t(
      "Как открыть кассовую смену",
      "Кассалык сменаны кантип ачуу керек",
      "How to open a POS shift",
    ),
    summary: t(
      "Выберите кассу и зафиксируйте деньги в ящике на начало дня.",
      "Кассаны тандап, күн башындагы акчаны жазыңыз.",
      "Choose a register and record opening cash.",
    ),
    keywords: t(
      "открыть смена касса начало день размен",
      "смена ачуу касса күн башы",
      "open shift register start day opening cash",
    ),
    aliases: t(
      "начать смену открыть кассу начать день",
      "сменаны баштоо кассаны ачуу күндү баштоо",
      "start shift open till begin day",
    ),
    roles: ["owner", "manager", "cashier"],
    estimatedMinutes: 2,
    appRoute: "/pos",
    steps: [
      step(
        t("Откройте POS", "POS'ту ачыңыз", "Open POS"),
        t(
          "Выберите нужный магазин и кассу.",
          "Керектүү дүкөн менен кассаны тандаңыз.",
          "Choose the correct store and register.",
        ),
        {
          media: posScreen(
            t(
              "Проверьте магазин и кассу",
              "Дүкөн менен кассаны текшериңиз",
              "Verify store and register",
            ),
            16,
            13,
          ),
        },
      ),
      step(
        t("Введите начальную сумму", "Баштапкы сумманы киргизиңиз", "Enter opening cash"),
        t(
          "Посчитайте наличные, которые уже лежат в ящике.",
          "Кассада бар накталай акчаны санаңыз.",
          "Count the cash already in the drawer.",
        ),
      ),
      step(
        t("Откройте смену", "Сменаны ачыңыз", "Open the shift"),
        t(
          "После подтверждения продажи будут относиться к этой кассе и сотруднику.",
          "Ырастоодон кийин сатуулар ушул кассага жана кызматкерге жазылат.",
          "After confirmation, sales are attributed to this register and employee.",
        ),
      ),
    ],
    success: t(
      "Касса готова принимать продажи.",
      "Касса сатууга даяр.",
      "The register is ready for sales.",
    ),
    relatedGuides: ["pos/make-sale", "pos/hold-receipt", "pos/close-shift"],
  }),
  guide({
    slug: "make-sale",
    category: "pos",
    title: t("Как сделать продажу", "Сатууну кантип жүргүзүү керек", "How to make a sale"),
    summary: t(
      "Добавьте товары, примите оплату и завершите чек.",
      "Товарларды кошуп, төлөмдү кабыл алып, чекти бүтүрүңүз.",
      "Add products, accept payment, and complete the receipt.",
    ),
    keywords: t(
      "продажа чек товар оплата наличные карта касса",
      "сатуу чек товар төлөм накталай карта касса",
      "sale receipt product payment cash card pos",
    ),
    aliases: t(
      "пробить чек продать товар оформить покупку",
      "чек чыгаруу товар сатуу",
      "ring up checkout sell item",
    ),
    roles: ["owner", "manager", "cashier"],
    estimatedMinutes: 3,
    appRoute: "/pos/sell",
    steps: [
      step(
        t("Добавьте товар", "Товарды кошуңуз", "Add a product"),
        t(
          "Нажмите карточку, найдите по названию или сканируйте штрихкод.",
          "Карточканы басыңыз, аталыш менен табыңыз же штрихкодду сканерлеңиз.",
          "Tap a product, search by title, or scan its barcode.",
        ),
        {
          media: posScreen(
            t("Каталог и поиск", "Каталог жана издөө", "Catalog and search"),
            28,
            24,
          ),
        },
      ),
      step(
        t("Проверьте корзину", "Себетти текшериңиз", "Review the cart"),
        t(
          "Убедитесь в количестве, цене и скидке каждой позиции.",
          "Ар бир позициянын санын, баасын жана арзандатуусун текшериңиз.",
          "Verify quantity, price, and discount for each line.",
        ),
      ),
      step(
        t("Нажмите «Оплата»", "«Төлөм» баскычын басыңыз", "Select Payment"),
        t(
          "Выберите наличные, карту или несколько способов.",
          "Накталай, карта же бир нече ыкманы тандаңыз.",
          "Choose cash, card, or multiple methods.",
        ),
      ),
      step(
        t("Завершите чек", "Чекти бүтүрүңүз", "Complete the receipt"),
        t(
          "Проверьте сумму от покупателя и подтвердите продажу один раз.",
          "Кардардан алынган сумманы текшерип, сатууну бир жолу ырастаңыз.",
          "Verify the amount received and confirm once.",
        ),
      ),
    ],
    success: t(
      "Чек создан, оплата записана, остаток уменьшен.",
      "Чек түзүлдү, төлөм жазылды, калдык азайды.",
      "The receipt is created, payment recorded, and stock reduced.",
    ),
    relatedGuides: [
      "pos/apply-discount",
      "pos/split-payment",
      "pos/hold-receipt",
      "pos/return-sale",
    ],
    troubleshooting: [
      {
        question: t("Товар не находится?", "Товар табылбай жатабы?", "Product not found?"),
        answer: t(
          "Проверьте магазин, остаток и назначение товара этой точке.",
          "Дүкөндү, калдыкты жана товар ушул жерге дайындалганын текшериңиз.",
          "Check store selection, stock, and product assignment.",
        ),
      },
    ],
  }),
  guide({
    slug: "apply-discount",
    category: "pos",
    title: t(
      "Как применить скидку",
      "Арзандатууну кантип колдонуу керек",
      "How to apply a discount",
    ),
    summary: t(
      "Укажите скидку на позицию и проверьте итог до оплаты.",
      "Позицияга арзандатуу коюп, төлөмгө чейин жыйынтыкты текшериңиз.",
      "Apply a line discount and verify the total before payment.",
    ),
    keywords: t(
      "скидка процент сумма цена акция касса",
      "арзандатуу пайыз сумма баа акция касса",
      "discount percent amount price promotion pos",
    ),
    aliases: t(
      "сделать дешевле уступить клиенту уменьшить цену",
      "бааны түшүрүү кардарга арзандатуу",
      "lower price give customer discount",
    ),
    roles: ["owner", "manager", "cashier"],
    estimatedMinutes: 2,
    appRoute: "/pos/sell",
    steps: [
      step(
        t("Добавьте товар в корзину", "Товарды себетке кошуңуз", "Add the product"),
        t(
          "Скидка применяется к выбранной строке.",
          "Арзандатуу тандалган сапка колдонулат.",
          "The discount applies to the selected line.",
        ),
      ),
      step(
        t("Откройте скидку", "Арзандатууну ачыңыз", "Open discount"),
        t(
          "Нажмите действие скидки рядом с товаром.",
          "Товардын жанындагы арзандатуу аракетин басыңыз.",
          "Use the discount action next to the item.",
        ),
        {
          media: posScreen(t("Скидка позиции", "Позициянын арзандатуусу", "Line discount"), 77, 42),
        },
      ),
      step(
        t("Введите значение", "Маанини киргизиңиз", "Enter the value"),
        t(
          "Выберите процент или сумму, если оба варианта доступны.",
          "Пайызды же сумманы тандаңыз, эгер экөө тең жеткиликтүү болсо.",
          "Choose percentage or amount when both are available.",
        ),
      ),
      step(
        t("Проверьте итог", "Жыйынтыкты текшериңиз", "Verify the total"),
        t(
          "Старая цена, скидка и новая сумма должны быть понятны до оплаты.",
          "Эски баа, арзандатуу жана жаңы сумма төлөмгө чейин түшүнүктүү болушу керек.",
          "Original price, discount, and new total should be clear before payment.",
        ),
      ),
    ],
    success: t(
      "Скидка сохранена в чеке и учтена в итоговой сумме.",
      "Арзандатуу чекте сакталды жана жыйынтык суммада эсептелди.",
      "The discount is stored in the receipt and included in the total.",
    ),
    relatedGuides: ["pos/make-sale", "pos/split-payment", "pos/return-sale"],
  }),
  guide({
    slug: "split-payment",
    category: "pos",
    title: t("Как разделить оплату", "Төлөмдү кантип бөлүү керек", "How to split a payment"),
    summary: t(
      "Примите часть наличными, а часть картой в одном чеке.",
      "Бир чектин бир бөлүгүн накталай, бир бөлүгүн карта менен алыңыз.",
      "Accept cash and card in one receipt.",
    ),
    keywords: t(
      "разделить оплата карта наличные частями",
      "бөлүп төлөө карта накталай бөлүк",
      "split payment cash card partial tender",
    ),
    aliases: t(
      "половина картой половина наличными два способа",
      "жарымы карта жарымы накталай эки ыкма",
      "half card half cash two methods",
    ),
    roles: ["owner", "manager", "cashier"],
    estimatedMinutes: 2,
    appRoute: "/pos/sell",
    steps: [
      step(
        t("Откройте оплату", "Төлөмдү ачыңыз", "Open payment"),
        t(
          "Сначала полностью проверьте корзину и итог.",
          "Адегенде себетти жана жыйынтыкты толук текшериңиз.",
          "Review the cart and total first.",
        ),
      ),
      step(
        t("Выберите разделение", "Бөлүп төлөөнү тандаңыз", "Choose split payment"),
        t(
          "Добавьте первый способ и его сумму.",
          "Биринчи ыкманы жана анын суммасын кошуңуз.",
          "Add the first method and amount.",
        ),
        {
          media: posScreen(
            t("Добавьте способы оплаты", "Төлөм ыкмаларын кошуңуз", "Add payment methods"),
            75,
            61,
            true,
          ),
        },
      ),
      step(
        t("Добавьте остаток", "Калган сумманы кошуңуз", "Add the remaining amount"),
        t(
          "Второй способ должен закрыть оставшуюся сумму точно.",
          "Экинчи ыкма калган сумманы так жабышы керек.",
          "The second method must cover the exact remainder.",
        ),
      ),
      step(
        t("Завершите продажу", "Сатууну бүтүрүңүз", "Complete the sale"),
        t(
          "Проверьте обе строки оплаты и подтвердите.",
          "Эки төлөм сабын текшерип, ырастаңыз.",
          "Verify both payment lines and confirm.",
        ),
      ),
    ],
    success: t(
      "Один чек содержит обе оплаты, без двойной продажи.",
      "Бир чек эки төлөмдү камтыйт, кош сатуу жок.",
      "One receipt contains both payments without a duplicate sale.",
    ),
    relatedGuides: ["pos/make-sale", "pos/apply-discount", "pos/hold-receipt"],
  }),
  guide({
    slug: "hold-receipt",
    category: "pos",
    title: t("Как отложить чек", "Чекти кантип убактылуу сактоо керек", "How to hold a receipt"),
    summary: t(
      "Сохраните корзину и обслужите следующего покупателя.",
      "Себетти сактап, кийинки кардарды тейлеңиз.",
      "Save the cart and serve the next customer.",
    ),
    keywords: t(
      "отложить чек удержать корзина черновик",
      "чекти калтыруу себет черновик",
      "hold receipt park sale cart draft",
    ),
    aliases: t(
      "покупатель вернется сохранить покупку отложенный чек",
      "кардар кайтып келет сатып алууну сактоо",
      "customer coming back park transaction",
    ),
    roles: ["manager", "cashier"],
    estimatedMinutes: 2,
    appRoute: "/pos/sell",
    steps: [
      step(
        t("Соберите корзину", "Себетти толтуруңуз", "Build the cart"),
        t(
          "Добавьте товары и проверьте количество.",
          "Товарларды кошуп, санын текшериңиз.",
          "Add products and verify quantities.",
        ),
      ),
      step(
        t("Нажмите «Отложить»", "«Калтыруу» баскычын басыңыз", "Select Hold"),
        t(
          "При необходимости добавьте короткую заметку.",
          "Керек болсо кыска эскертүү кошуңуз.",
          "Add a short note if useful.",
        ),
        {
          media: posScreen(
            t("Отложить текущий чек", "Учурдагы чекти калтыруу", "Hold current receipt"),
            69,
            78,
          ),
        },
      ),
      step(
        t("Подтвердите", "Ырастаңыз", "Confirm"),
        t(
          "Корзина очистится для новой продажи. Остаток пока не изменится.",
          "Жаңы сатуу үчүн себет тазаланат. Калдык азырынча өзгөрбөйт.",
          "The cart clears for a new sale; stock does not change yet.",
        ),
      ),
    ],
    success: t(
      "Чек сохранён среди отложенных без списания товара.",
      "Чек товарды азайтпастан сакталды.",
      "The receipt is held without reducing stock.",
    ),
    relatedGuides: ["pos/resume-receipt", "pos/make-sale", "pos/close-shift"],
  }),
  guide({
    slug: "resume-receipt",
    category: "pos",
    title: t(
      "Как продолжить отложенный чек",
      "Калтырылган чекти кантип улантуу керек",
      "How to resume a held receipt",
    ),
    summary: t(
      "Верните сохранённую корзину и завершите продажу.",
      "Сакталган себетти кайтарып, сатууну бүтүрүңүз.",
      "Restore a saved cart and complete the sale.",
    ),
    keywords: t(
      "продолжить отложенный чек вернуть корзину",
      "калтырылган чекти улантуу себетти кайтаруу",
      "resume held receipt restore cart",
    ),
    aliases: t(
      "найти сохраненный чек покупатель вернулся",
      "сакталган чекти табуу кардар келди",
      "find parked sale customer returned",
    ),
    roles: ["manager", "cashier"],
    estimatedMinutes: 2,
    appRoute: "/pos/sell",
    steps: [
      step(
        t("Откройте отложенные", "Калтырылган чектерди ачыңыз", "Open held receipts"),
        t(
          "Используйте список отложенных чеков на кассе.",
          "Кассадагы калтырылган чектердин тизмесин колдонуңуз.",
          "Use the held receipts list in POS.",
        ),
        {
          media: posScreen(
            t("Список отложенных чеков", "Калтырылган чектер", "Held receipts"),
            82,
            18,
          ),
        },
      ),
      step(
        t("Найдите нужный чек", "Керектүү чекти табыңыз", "Find the receipt"),
        t(
          "Сверьте время, кассира, заметку и сумму.",
          "Убакытты, кассирди, эскертүүнү жана сумманы текшериңиз.",
          "Check time, cashier, note, and total.",
        ),
      ),
      step(
        t("Нажмите «Продолжить»", "«Улантуу» баскычын басыңыз", "Select Resume"),
        t(
          "Товары вернутся в корзину текущего кассира.",
          "Товарлар учурдагы кассирдин себетине кайтып келет.",
          "Items return to the current cashier's cart.",
        ),
      ),
      step(
        t("Примите оплату", "Төлөмдү кабыл алыңыз", "Take payment"),
        t(
          "Проверьте актуальные позиции и завершите чек один раз.",
          "Учурдагы позицияларды текшерип, чекти бир жолу бүтүрүңүз.",
          "Review current lines and complete once.",
        ),
      ),
    ],
    success: t(
      "Отложенный чек завершён и списал остаток один раз.",
      "Калтырылган чек бүтүп, калдык бир жолу азайды.",
      "The held receipt is completed and stock is deducted once.",
    ),
    relatedGuides: ["pos/hold-receipt", "pos/make-sale", "pos/close-shift"],
  }),
  guide({
    slug: "return-sale",
    category: "pos",
    title: t("Как оформить возврат", "Кайтарууну кантип жүргүзүү керек", "How to process a return"),
    summary: t(
      "Найдите исходный чек и верните только фактически принятый товар.",
      "Баштапкы чекти таап, чындап кабыл алынган товарды гана кайтарыңыз.",
      "Find the original receipt and return only the items received.",
    ),
    keywords: t(
      "возврат refund чек вернуть деньги товар",
      "кайтаруу чек акча товар",
      "return refund receipt money item",
    ),
    aliases: t(
      "клиент принес товар отменить покупку вернуть покупку",
      "кардар товарды кайтарды сатып алууну жокко чыгаруу",
      "customer brought item back reverse purchase",
    ),
    roles: ["owner", "manager", "cashier"],
    estimatedMinutes: 4,
    appRoute: "/pos/history",
    steps: [
      step(
        t("Откройте журнал чеков", "Чектер журналын ачыңыз", "Open receipt history"),
        t(
          "Найдите завершённую продажу по номеру, дате или сумме.",
          "Бүткөн сатууну номер, күн же сумма боюнча табыңыз.",
          "Find the completed sale by number, date, or amount.",
        ),
        {
          media: posScreen(
            t("Найдите исходный чек", "Баштапкы чекти табыңыз", "Find the original receipt"),
            81,
            20,
          ),
        },
      ),
      step(
        t("Нажмите «Возврат»", "«Кайтаруу» баскычын басыңыз", "Select Return"),
        t(
          "Возврат создаётся только из исходного POS-чека.",
          "Кайтаруу баштапкы POS-чектен гана түзүлөт.",
          "Returns are created only from the original POS receipt.",
        ),
      ),
      step(
        t(
          "Выберите товар и количество",
          "Товарды жана санын тандаңыз",
          "Choose items and quantities",
        ),
        t(
          "Не включайте товар, который покупатель не вернул.",
          "Кардар кайтарбаган товарды кошпоңуз.",
          "Do not include items the customer did not return.",
        ),
      ),
      step(
        t("Укажите возврат денег", "Акчаны кайтарууну көрсөтүңүз", "Enter the refund"),
        t(
          "Проверьте способ и сумму возврата, затем подтвердите.",
          "Кайтаруу ыкмасы менен суммасын текшерип, ырастаңыз.",
          "Verify refund method and amount, then confirm.",
        ),
      ),
    ],
    success: t(
      "Возврат связан с чеком, остаток и сумма восстановлены корректно.",
      "Кайтаруу чекке байланышып, калдык жана сумма туура калыбына келди.",
      "The return is linked to the receipt and stock and money are restored correctly.",
    ),
    relatedGuides: ["pos/make-sale", "pos/close-shift", "reports/analytics-basics"],
    troubleshooting: [
      {
        question: t(
          "Кнопка возврата недоступна?",
          "Кайтаруу баскычы жеткиликсизби?",
          "Return unavailable?",
        ),
        answer: t(
          "Проверьте открытую смену, активную кассу и оставшееся возвратное количество.",
          "Ачык сменаны, активдүү кассаны жана калган кайтарылуучу санды текшериңиз.",
          "Check the open shift, active register, and remaining returnable quantity.",
        ),
      },
    ],
  }),
  guide({
    slug: "close-shift",
    category: "pos",
    title: t("Как закрыть смену", "Сменаны кантип жабуу керек", "How to close a shift"),
    summary: t(
      "Сверьте деньги в кассе и завершите рабочий день без открытых чеков.",
      "Кассадагы акчаны текшерип, ачык чектерсиз иш күнүн бүтүрүңүз.",
      "Count the drawer and finish the day without open receipts.",
    ),
    keywords: t(
      "закрыть смена касса день X отчет z отчет наличные",
      "смена жабуу касса күн x отчет z отчет накталай",
      "close shift register end day x report z report cash",
    ),
    aliases: t(
      "закрыть кассу закончить день завершить смену снять X отчет",
      "кассаны жабуу күндү бүтүрүү сменаны аяктоо",
      "close till finish day end shift cash up",
    ),
    roles: ["owner", "manager", "cashier"],
    estimatedMinutes: 4,
    appRoute: "/pos/shifts",
    steps: [
      step(
        t(
          "Завершите или отложите чеки",
          "Чектерди бүтүрүңүз же калтырыңыз",
          "Resolve open receipts",
        ),
        t(
          "Смена не закроется, если остались активные или возвратные черновики.",
          "Активдүү же кайтаруу черновиктери калса, смена жабылбайт.",
          "The shift cannot close while active sale or return drafts remain.",
        ),
      ),
      step(
        t("Откройте текущую смену", "Учурдагы сменаны ачыңыз", "Open the current shift"),
        t(
          "Выберите ту же кассу, на которой работали.",
          "Иштеген кассаңызды тандаңыз.",
          "Choose the register used during the shift.",
        ),
        { media: posScreen(t("Смена и касса", "Смена жана касса", "Shift and register"), 18, 14) },
      ),
      step(
        t("Посчитайте наличные", "Накталай акчаны санаңыз", "Count cash"),
        t(
          "Введите фактическую сумму из кассового ящика.",
          "Кассадагы чыныгы сумманы киргизиңиз.",
          "Enter the actual amount in the drawer.",
        ),
      ),
      step(
        t("Сверьте расхождение", "Айырманы текшериңиз", "Review the difference"),
        t(
          "Ожидаемая и фактическая суммы должны быть понятны до закрытия.",
          "Күтүлгөн жана чыныгы суммалар жабууга чейин түшүнүктүү болушу керек.",
          "Expected and actual cash should be clear before closing.",
        ),
      ),
      step(
        t("Закройте смену", "Сменаны жабыңыз", "Close the shift"),
        t(
          "Подтвердите один раз и сохраните итоговый отчёт.",
          "Бир жолу ырастап, жыйынтык отчётту сактаңыз.",
          "Confirm once and keep the closing report.",
        ),
      ),
    ],
    success: t(
      "Смена закрыта, итог и расхождение сохранены.",
      "Смена жабылды, жыйынтык жана айырма сакталды.",
      "The shift is closed and its totals and variance are recorded.",
    ),
    relatedGuides: ["pos/open-shift", "pos/make-sale", "reports/export-reports"],
  }),
  guide({
    slug: "add-employee",
    category: "settings",
    title: t("Как добавить сотрудника", "Кызматкерди кантип кошуу керек", "How to add an employee"),
    summary: t(
      "Пригласите сотрудника и дайте только нужную роль и магазины.",
      "Кызматкерди чакырып, керектүү роль менен дүкөндөрдү гана бериңиз.",
      "Invite an employee with only the role and stores they need.",
    ),
    keywords: t(
      "сотрудник пользователь приглашение роль кассир менеджер доступ",
      "кызматкер колдонуучу чакыруу роль кассир менеджер укук",
      "employee user invite role cashier manager access",
    ),
    aliases: t(
      "добавить кассира создать логин дать доступ",
      "кассир кошуу логин түзүү кирүү берүү",
      "add cashier create login grant access",
    ),
    roles: ["owner"],
    estimatedMinutes: 4,
    appRoute: "/settings/users",
    steps: [
      step(
        t("Откройте пользователей", "Колдонуучуларды ачыңыз", "Open Users"),
        t(
          "Раздел находится в настройках Bazaar.",
          "Бөлүм Bazaar жөндөөлөрүндө жайгашкан.",
          "The section is in Bazaar settings.",
        ),
        {
          media: dashboardScreen(
            t("Настройки → Пользователи", "Жөндөөлөр → Колдонуучулар", "Settings → Users"),
            12,
            46,
          ),
        },
      ),
      step(
        t("Нажмите «Пригласить»", "«Чакыруу» баскычын басыңыз", "Select Invite"),
        t(
          "Введите рабочий email сотрудника.",
          "Кызматкердин жумуш email'ин киргизиңиз.",
          "Enter the employee's work email.",
        ),
      ),
      step(
        t("Выберите роль", "Ролду тандаңыз", "Choose a role"),
        t(
          "Кассиру не нужны права владельца или управления интеграциями.",
          "Кассирге ээсинин же интеграцияларды башкаруу укугу керек эмес.",
          "A cashier does not need owner or integration-management permissions.",
        ),
      ),
      step(
        t("Назначьте магазины", "Дүкөндөрдү дайындаңыз", "Assign stores"),
        t(
          "Оставьте только те точки, где сотрудник действительно работает.",
          "Кызматкер чындап иштеген жерлерди гана калтырыңыз.",
          "Keep only the locations where the employee actually works.",
        ),
      ),
      step(
        t("Отправьте приглашение", "Чакырууну жөнөтүңүз", "Send the invitation"),
        t(
          "Сотрудник завершит регистрацию по безопасной ссылке.",
          "Кызматкер коопсуз шилтеме аркылуу каттоону бүтүрөт.",
          "The employee completes registration through a secure link.",
        ),
      ),
    ],
    success: t(
      "Сотрудник получил доступ только к назначенной работе.",
      "Кызматкер дайындалган ишке гана кире алат.",
      "The employee has access only to assigned work.",
    ),
    relatedGuides: ["pos/open-shift", "pos/make-sale", "reports/analytics-basics"],
  }),
  guide({
    slug: "analytics-basics",
    category: "reports",
    title: t("Как читать аналитику", "Аналитиканы кантип окуу керек", "How to read analytics"),
    summary: t(
      "Поймите продажи, себестоимость, маржу и остатки за выбранный период.",
      "Тандалган мезгилдеги сатуу, өздүк нарк, маржа жана калдыктарды түшүнүңүз.",
      "Understand sales, cost, margin, and inventory for a period.",
    ),
    keywords: t(
      "аналитика dashboard продажи выручка маржа себестоимость",
      "аналитика сатуу киреше маржа өздүк нарк",
      "analytics dashboard sales revenue margin cost",
    ),
    aliases: t(
      "как дела в магазине сколько заработали итоги дня",
      "дүкөн кандай иштеди канча таптык күн жыйынтыгы",
      "how is business doing earnings daily result",
    ),
    roles: ["owner", "manager"],
    estimatedMinutes: 4,
    appRoute: "/reports/analytics",
    steps: [
      step(
        t("Выберите период", "Мезгилди тандаңыз", "Choose a period"),
        t(
          "Сравнивайте одинаковые по длине периоды.",
          "Узундугу бирдей мезгилдерди салыштырыңыз.",
          "Compare periods of the same length.",
        ),
      ),
      step(
        t(
          "Проверьте выручку и чеки",
          "Киреше менен чектерди текшериңиз",
          "Review revenue and receipts",
        ),
        t(
          "Выручка показывает сумму продаж, количество чеков — поток покупателей.",
          "Киреше сатуу суммасын, чектердин саны кардарлар агымын көрсөтөт.",
          "Revenue shows sales value; receipt count shows customer flow.",
        ),
        {
          media: dashboardScreen(
            t("Выручка и количество продаж", "Киреше жана сатуу саны", "Revenue and sale count"),
            23,
            29,
          ),
        },
      ),
      step(
        t(
          "Посмотрите себестоимость и маржу",
          "Өздүк нарк менен маржаны караңыз",
          "Review cost and margin",
        ),
        t(
          "Маржа — не вся выручка, а разница после себестоимости товара.",
          "Маржа бардык киреше эмес, товардын өздүк наркынан кийинки айырма.",
          "Margin is revenue minus product cost, not total revenue.",
        ),
      ),
      step(
        t(
          "Сравните магазины и товары",
          "Дүкөндөрдү жана товарларды салыштырыңыз",
          "Compare stores and products",
        ),
        t(
          "Откройте лидеров и отстающие позиции, затем проверьте причины.",
          "Лидерлерди жана артта калган позицияларды ачып, себептерин текшериңиз.",
          "Open top and lagging items, then investigate the reasons.",
        ),
      ),
    ],
    success: t(
      "Вы знаете, что продалось, сколько это стоило и где нужен контроль.",
      "Эмне сатылганын, анын наркын жана кайда көзөмөл керек экенин билесиз.",
      "You know what sold, what it cost, and where attention is needed.",
    ),
    relatedGuides: [
      "reports/export-reports",
      "inventory/inventory-count",
      "integrations/connect-marketplace",
    ],
  }),
  guide({
    slug: "export-reports",
    category: "reports",
    title: t(
      "Как открыть и выгрузить отчёт",
      "Отчётту кантип ачып, жүктөп алуу керек",
      "How to open and export a report",
    ),
    summary: t(
      "Выберите вопрос, период и магазин, затем выгрузите проверенный результат.",
      "Суроону, мезгилди жана дүкөндү тандап, текшерилген жыйынтыкты жүктөңүз.",
      "Choose a business question, period, and store, then export the result.",
    ),
    keywords: t(
      "отчет экспорт excel csv продажи склад скачать",
      "отчёт экспорт excel csv сатуу кампа жүктөө",
      "report export excel csv sales inventory download",
    ),
    aliases: t(
      "выгрузить таблицу скачать отчет распечатать итоги",
      "таблица жүктөө отчёт алуу жыйынтык басуу",
      "download spreadsheet print totals",
    ),
    roles: ["owner", "manager", "stockkeeper"],
    estimatedMinutes: 3,
    appRoute: "/reports",
    steps: [
      step(
        t("Выберите нужный отчёт", "Керектүү отчётту тандаңыз", "Choose a report"),
        t(
          "Начните с вопроса: продажи, остатки, движение или стоимость.",
          "Суроодон баштаңыз: сатуу, калдык, кыймыл же нарк.",
          "Start with the question: sales, stock, movement, or value.",
        ),
        {
          media: dashboardScreen(
            t(
              "Отчёты отвечают на бизнес-вопрос",
              "Отчёттор бизнес-суроого жооп берет",
              "Reports answer a business question",
            ),
            65,
            34,
          ),
        },
      ),
      step(
        t("Задайте фильтры", "Фильтрлерди коюңуз", "Set filters"),
        t(
          "Проверьте период, магазин и статус до выгрузки.",
          "Жүктөөдөн мурун мезгилди, дүкөндү жана статусту текшериңиз.",
          "Verify period, store, and status before export.",
        ),
      ),
      step(
        t("Проверьте таблицу", "Таблицаны текшериңиз", "Review the table"),
        t(
          "Убедитесь, что результат соответствует вопросу и фильтрам.",
          "Жыйынтык суроого жана фильтрлерге туура келерин текшериңиз.",
          "Confirm the result matches your question and filters.",
        ),
      ),
      step(
        t("Нажмите «Экспорт»", "«Экспорт» баскычын басыңыз", "Select Export"),
        t(
          "Bazaar сформирует файл по текущим фильтрам.",
          "Bazaar учурдагы фильтрлер боюнча файл түзөт.",
          "Bazaar generates a file using the current filters.",
        ),
      ),
    ],
    success: t(
      "Файл содержит тот же проверенный набор данных, что и отчёт.",
      "Файл отчёттогу текшерилген маалыматтарды камтыйт.",
      "The file contains the same verified data shown in the report.",
    ),
    relatedGuides: ["reports/analytics-basics", "inventory/inventory-count", "pos/close-shift"],
  }),
  guide({
    slug: "choose-store",
    category: "getting-started",
    title: t(
      "Как создать или выбрать магазин",
      "Дүкөндү кантип түзүү же тандоо керек",
      "How to create or choose a store",
    ),
    summary: t(
      "Создайте рабочую точку и убедитесь, что товары и касса относятся к нужному магазину.",
      "Иш ордун түзүп, товарлар менен касса туура дүкөнгө тиешелүү экенин текшериңиз.",
      "Create a location and make sure products and POS use the right store.",
    ),
    keywords: t(
      "магазин точка филиал создать выбрать адрес",
      "дүкөн чекит филиал түзүү тандоо дарек",
      "store location branch create choose address",
    ),
    aliases: t(
      "добавить магазин новая точка открыть филиал сменить магазин",
      "дүкөн кошуу жаңы чекит филиал ачуу дүкөндү алмаштыруу",
      "add store new location open branch switch store",
    ),
    roles: ["owner"],
    estimatedMinutes: 2,
    appRoute: "/stores",
    steps: [
      step(
        t("Откройте «Магазины»", "«Дүкөндөр» бөлүмүн ачыңыз", "Open Stores"),
        t(
          "В меню настроек выберите список магазинов.",
          "Жөндөөлөр менюсунан дүкөндөрдүн тизмесин тандаңыз.",
          "Choose the store list from Settings.",
        ),
      ),
      step(
        t(
          "Выберите магазин или создайте новый",
          "Дүкөндү тандаңыз же жаңысын түзүңүз",
          "Choose or create a store",
        ),
        t(
          "Для новой точки укажите понятное название и адрес.",
          "Жаңы чекит үчүн түшүнүктүү аталыш жана дарек жазыңыз.",
          "For a new location, enter a clear name and address.",
        ),
        {
          media: dashboardScreen(
            t(
              "Проверьте выбранный магазин",
              "Тандалган дүкөндү текшериңиз",
              "Verify the selected store",
            ),
            24,
            16,
          ),
        },
      ),
      step(
        t(
          "Проверьте доступ сотрудников",
          "Кызматкерлердин кирүүсүн текшериңиз",
          "Check staff access",
        ),
        t(
          "Назначьте нужную точку сотрудникам, которые будут с ней работать.",
          "Бул чекитте иштей турган кызматкерлерге дүкөндү дайындаңыз.",
          "Assign the location to the employees who will use it.",
        ),
      ),
      step(
        t(
          "Выберите магазин в работе",
          "Иштөө үчүн дүкөндү тандаңыз",
          "Select the store while working",
        ),
        t(
          "Перед товаром, остатком или продажей всегда проверяйте активную точку.",
          "Товар, калдык же сатуудан мурун активдүү чекитти текшериңиз.",
          "Before products, stock, or sales, always verify the active location.",
        ),
      ),
    ],
    success: t(
      "Рабочая точка готова для товаров, остатков и кассы.",
      "Иш орду товарлар, калдыктар жана касса үчүн даяр.",
      "The location is ready for products, stock, and POS.",
    ),
    relatedGuides: [
      "settings/add-employee",
      "products/add-product",
      "inventory/receiving",
      "pos/open-shift",
    ],
  }),
  guide({
    slug: "connect-marketplace",
    category: "integrations",
    title: t(
      "Как подготовить интеграцию",
      "Интеграцияны кантип даярдоо керек",
      "How to prepare an integration",
    ),
    summary: t(
      "Проверьте каталог, магазин и доступ перед первой синхронизацией.",
      "Биринчи синхрондоштуруудан мурун каталогду, дүкөндү жана кирүүнү текшериңиз.",
      "Verify catalog, store, and access before the first sync.",
    ),
    keywords: t(
      "интеграция маркетплейс m-market bakai o market api синхронизация",
      "интеграция маркетплейс m-market bakai o market api синхрондоштуруу",
      "integration marketplace m-market bakai o market api sync",
    ),
    aliases: t(
      "подключить интернет магазин выгрузить товары маркетплейс",
      "интернет дүкөн кошуу товар жүктөө маркетплейс",
      "connect online store export products marketplace",
    ),
    roles: ["owner", "manager"],
    estimatedMinutes: 5,
    appRoute: "/operations/integrations",
    steps: [
      step(
        t("Выберите канал", "Каналды тандаңыз", "Choose a channel"),
        t(
          "Откройте M-Market, Bakai Store, O! Market или Bazaar API.",
          "M-Market, Bakai Store, O! Market же Bazaar API'ни ачыңыз.",
          "Open M-Market, Bakai Store, O! Market, or Bazaar API.",
        ),
        {
          media: integrationScreen(
            t("Выберите нужный канал", "Керектүү каналды тандаңыз", "Choose the channel"),
            31,
            29,
          ),
        },
      ),
      step(
        t("Проверьте магазин", "Дүкөндү текшериңиз", "Verify the store"),
        t(
          "Сопоставьте только тот магазин, каталог которого нужно отправлять.",
          "Жөнөтүлө турган каталогдун дүкөнүн гана дал келтириңиз.",
          "Map only the store whose catalog should be sent.",
        ),
      ),
      step(
        t(
          "Заполните обязательные данные",
          "Милдеттүү маалыматтарды толтуруңуз",
          "Complete required data",
        ),
        t(
          "Исправьте цену, категорию, фото и характеристики, отмеченные проверкой.",
          "Текшерүү көрсөткөн баа, категория, сүрөт жана мүнөздөмөлөрдү оңдоңуз.",
          "Fix price, category, image, and specifications flagged by validation.",
        ),
      ),
      step(
        t("Запустите проверку", "Текшерүүнү баштаңыз", "Run validation"),
        t(
          "Сначала добейтесь чистого результата, затем запускайте экспорт.",
          "Адегенде таза жыйынтыкка жетип, андан кийин экспортту баштаңыз.",
          "Get a clean validation result before starting export.",
        ),
      ),
    ],
    success: t(
      "Канал готов к первой контролируемой синхронизации.",
      "Канал биринчи көзөмөлдөнгөн синхрондоштурууга даяр.",
      "The channel is ready for its first controlled sync.",
    ),
    relatedGuides: [
      "products/edit-product",
      "products/import-products",
      "reports/analytics-basics",
    ],
    troubleshooting: [
      {
        question: t(
          "Экспорт не запускается?",
          "Экспорт башталбай жатабы?",
          "Export will not start?",
        ),
        answer: t(
          "Откройте результат проверки: Bazaar блокирует отправку некорректных товаров.",
          "Текшерүү жыйынтыгын ачыңыз: Bazaar туура эмес товарларды жөнөтпөйт.",
          "Open validation results; Bazaar blocks invalid products from being sent.",
        ),
      },
    ],
  }),
];

export const helpTasks: HelpTask[] = [
  {
    title: t("Продать товар", "Товар сатуу", "Sell a product"),
    description: t("Оформить чек на кассе", "Кассада чек чыгаруу", "Complete a POS sale"),
    guideId: "pos/make-sale",
    icon: "register",
  },
  {
    title: t("Добавить товар", "Товар кошуу", "Add a product"),
    description: t("Создать карточку вручную", "Карточканы кол менен түзүү", "Create one product"),
    guideId: "products/add-product",
    icon: "products",
  },
  {
    title: t("Добавить остаток", "Калдык кошуу", "Add stock"),
    description: t("Зафиксировать поступление", "Киришти каттоо", "Record received stock"),
    guideId: "inventory/receiving",
    icon: "receive",
  },
  {
    title: t("Оприходовать товар", "Товарды кириштөө", "Receive goods"),
    description: t("Количество и себестоимость", "Саны жана өздүк наркы", "Quantity and unit cost"),
    guideId: "inventory/receiving",
    icon: "receive",
  },
  {
    title: t("Переместить товар", "Товарды которуу", "Transfer stock"),
    description: t("Между двумя магазинами", "Эки дүкөндүн ортосунда", "Between two stores"),
    guideId: "inventory/transfer",
    icon: "transfer",
  },
  {
    title: t("Списать товар", "Товарды эсептен чыгаруу", "Write off stock"),
    description: t(
      "Порча, потеря, недостача",
      "Бузулуу, жоготуу, жетишпестик",
      "Damage, loss, shortage",
    ),
    guideId: "inventory/write-off",
    icon: "writeoff",
  },
  {
    title: t("Провести инвентаризацию", "Инвентаризация өткөрүү", "Run a stock count"),
    description: t(
      "Сверить факт с учётом",
      "Чыныгы санды эсеп менен салыштыруу",
      "Reconcile physical stock",
    ),
    guideId: "inventory/inventory-count",
    icon: "count",
  },
  {
    title: t("Добавить сотрудника", "Кызматкер кошуу", "Add an employee"),
    description: t(
      "Роль и доступные магазины",
      "Роль жана жеткиликтүү дүкөндөр",
      "Role and store access",
    ),
    guideId: "getting-started/choose-store",
    icon: "users",
  },
  {
    title: t("Посмотреть продажи", "Сатууларды көрүү", "View sales"),
    description: t(
      "Выручка, чеки и маржа",
      "Киреше, чектер жана маржа",
      "Revenue, receipts, margin",
    ),
    guideId: "reports/analytics-basics",
    icon: "reports",
  },
  {
    title: t("Подключить интеграцию", "Интеграция кошуу", "Connect an integration"),
    description: t(
      "Маркетплейс или Bazaar API",
      "Маркетплейс же Bazaar API",
      "Marketplace or Bazaar API",
    ),
    guideId: "integrations/connect-marketplace",
    icon: "integrations",
  },
];

export const helpJourney: HelpJourneyItem[] = [
  {
    title: t(
      "Создайте или выберите магазин",
      "Дүкөн түзүңүз же тандаңыз",
      "Create or choose a store",
    ),
    description: t(
      "Рабочая точка для товаров и кассы",
      "Товар жана касса үчүн иш орду",
      "The location for products and POS",
    ),
    guideId: "settings/add-employee",
    estimatedMinutes: 2,
  },
  {
    title: t("Добавьте первый товар", "Биринчи товарды кошуңуз", "Add your first product"),
    description: t(
      "Название и цена — достаточно для старта",
      "Баштоо үчүн аталыш жана баа жетиштүү",
      "A title and price are enough to start",
    ),
    guideId: "products/add-product",
    estimatedMinutes: 3,
  },
  {
    title: t("Добавьте остатки", "Калдыктарды кошуңуз", "Add stock"),
    description: t("Количество и себестоимость", "Саны жана өздүк наркы", "Quantity and unit cost"),
    guideId: "inventory/receiving",
    estimatedMinutes: 4,
  },
  {
    title: t("Откройте кассовую смену", "Кассалык сменаны ачыңыз", "Open a POS shift"),
    description: t(
      "Выберите кассу и начальную сумму",
      "Касса менен баштапкы сумманы тандаңыз",
      "Choose a register and opening cash",
    ),
    guideId: "pos/open-shift",
    estimatedMinutes: 2,
  },
  {
    title: t("Сделайте первую продажу", "Биринчи сатууну жасаңыз", "Make your first sale"),
    description: t("Товар, оплата и чек", "Товар, төлөм жана чек", "Product, payment, and receipt"),
    guideId: "pos/make-sale",
    estimatedMinutes: 3,
  },
  {
    title: t("Посмотрите результат", "Жыйынтыкты караңыз", "Review the result"),
    description: t(
      "Выручка, чек и остаток",
      "Киреше, чек жана калдык",
      "Revenue, receipt, and stock",
    ),
    guideId: "reports/analytics-basics",
    estimatedMinutes: 3,
  },
];

export const helpRoleTracks: HelpRoleTrack[] = [
  {
    role: "owner",
    title: t("Владелец", "Ээси", "Owner"),
    description: t(
      "Контроль бизнеса, команды и каналов продаж.",
      "Бизнести, команданы жана сатуу каналдарын көзөмөлдөө.",
      "Business, team, and sales-channel control.",
    ),
    guideIds: [
      "reports/analytics-basics",
      "reports/export-reports",
      "settings/add-employee",
      "integrations/connect-marketplace",
      "getting-started/choose-store",
    ],
  },
  {
    role: "manager",
    title: t("Менеджер", "Менеджер", "Manager"),
    description: t(
      "Каталог, склад, заказы и клиенты.",
      "Каталог, кампа, буйрутмалар жана кардарлар.",
      "Catalog, inventory, orders, and customers.",
    ),
    guideIds: [
      "products/add-product",
      "products/import-products",
      "inventory/receiving",
      "inventory/transfer",
      "inventory/write-off",
      "inventory/inventory-count",
      "reports/analytics-basics",
    ],
  },
  {
    role: "cashier",
    title: t("Кассир", "Кассир", "Cashier"),
    description: t(
      "Смена, чек, оплата и возврат.",
      "Смена, чек, төлөм жана кайтаруу.",
      "Shift, receipt, payment, and return.",
    ),
    guideIds: [
      "pos/open-shift",
      "pos/make-sale",
      "pos/apply-discount",
      "pos/split-payment",
      "pos/hold-receipt",
      "pos/resume-receipt",
      "pos/return-sale",
      "pos/close-shift",
    ],
  },
  {
    role: "stockkeeper",
    title: t("Кладовщик", "Кампа кызматкери", "Stockkeeper"),
    description: t(
      "Приёмка, перемещение, списание и пересчёт.",
      "Кабыл алуу, которуу, эсептен чыгаруу жана саноо.",
      "Receiving, transfers, write-offs, and counts.",
    ),
    guideIds: [
      "inventory/receiving",
      "inventory/transfer",
      "inventory/write-off",
      "inventory/inventory-count",
      "reports/export-reports",
    ],
  },
];

export const helpGuideId = (guide: HelpGuide) => `${guide.category}/${guide.slug}`;

export const getHelpGuide = (category: string, slug: string) =>
  helpGuides.find((guideItem) => guideItem.category === category && guideItem.slug === slug);

export const getHelpGuideById = (id: string) => {
  const [category, slug] = id.split("/");
  return category && slug ? getHelpGuide(category, slug) : undefined;
};

export const getHelpCategory = (slug: string) =>
  helpCategories.find((category) => category.slug === slug);

export const getGuidesForCategory = (category: HelpCategorySlug) =>
  helpGuides.filter((guideItem) => guideItem.category === category);
