import type { HelpGuide, HelpStep, LocalizedText } from "./types";
import { helpText as t } from "./ui";

const step = (
  title: LocalizedText,
  body: LocalizedText,
  options: Pick<HelpStep, "checklist" | "note"> = {},
): HelpStep => ({ title, body, ...options });

export const ordersAndCustomersGuides: HelpGuide[] = [
  {
    slug: "create-order",
    category: "orders",
    title: t(
      "Как создать заказ клиента",
      "Кардардын буйрутмасын кантип түзүү керек",
      "How to create a customer order",
    ),
    summary: t(
      "Выберите магазин, добавьте клиента и товары, затем создайте черновик.",
      "Дүкөндү тандап, кардар менен товарларды кошуп, андан кийин черновик түзүңүз.",
      "Choose a store, add customer details and products, then create a draft.",
    ),
    keywords: t(
      "заказ клиента новый черновик товар количество магазин",
      "кардардын буйрутмасы жаңы черновик товар саны дүкөн",
      "customer order new draft product quantity store",
    ),
    aliases: t(
      "оформить заказ заказ по телефону заказ на доставку",
      "буйрутманы каттоо телефон аркылуу буйрутма жеткирүү",
      "take an order phone order delivery order create sale order",
    ),
    roles: ["owner", "manager", "cashier"],
    estimatedMinutes: 4,
    appRoute: "/sales/orders/new",
    steps: [
      step(
        t(
          "Откройте «Заказы клиентов»",
          "«Кардарлардын буйрутмалары» бөлүмүн ачыңыз",
          "Open Customer orders",
        ),
        t(
          "В меню «Продажи» выберите «Заказы клиентов».",
          "«Сатуулар» менюсунан «Кардарлардын буйрутмалары» бөлүмүн тандаңыз.",
          "In the Sales menu, choose Customer orders.",
        ),
      ),
      step(
        t(
          "Нажмите «Новый заказ клиента»",
          "«Жаңы кардар буйрутмасы» баскычын басыңыз",
          "Select New customer order",
        ),
        t(
          "Откроется форма нового заказа.",
          "Жаңы буйрутманын формасы ачылат.",
          "The new-order form opens.",
        ),
      ),
      step(
        t(
          "Выберите магазин и укажите клиента",
          "Дүкөндү тандап, кардарды көрсөтүңүз",
          "Choose the store and enter the customer",
        ),
        t(
          "Проверьте точку продажи. Имя, email, телефон и адрес клиента заполняются по необходимости.",
          "Сатуу чекитин текшериңиз. Кардардын атын, email'ин, телефонун жана дарегин зарыл болсо толтуруңуз.",
          "Verify the selling location. Add the customer's name, email, phone, and address when needed.",
        ),
        {
          note: t(
            "Если указан email или телефон, Bazaar создаст или обновит запись в клиентской базе этого магазина.",
            "Email же телефон көрсөтүлсө, Bazaar бул дүкөндүн кардарлар базасындагы жазууну түзөт же жаңылайт.",
            "If an email or phone is provided, Bazaar creates or updates the record in that store's customer database.",
          ),
        },
      ),
      step(
        t("Добавьте товары", "Товарларды кошуңуз", "Add products"),
        t(
          "Найдите товар по названию, SKU или штрихкоду и укажите целое положительное количество.",
          "Товарды аталышы, SKU же штрихкоду боюнча таап, оң бүтүн санды көрсөтүңүз.",
          "Find each product by name, SKU, or barcode and enter a positive whole-number quantity.",
        ),
        {
          note: t(
            "Заказ нельзя создать, пока у каждой позиции не задана цена для выбранного магазина.",
            "Тандалган дүкөндө ар бир позициянын баасы болмоюнча буйрутма түзүлбөйт.",
            "Every line needs a price in the selected store before the order can be created.",
          ),
        },
      ),
      step(
        t("Проверьте и создайте", "Текшерип, түзүңүз", "Review and create"),
        t(
          "Сверьте магазин, количество, цены и итог. Нажмите «Создать заказ» — Bazaar откроет его как черновик.",
          "Дүкөндү, санды, бааларды жана жыйынтыкты текшериңиз. «Буйрутма түзүү» баскычын басканда Bazaar аны черновик катары ачат.",
          "Check the store, quantities, prices, and total. Select Create order; Bazaar opens it as a draft.",
        ),
      ),
    ],
    success: t(
      "Заказ создан как черновик и готов к проверке.",
      "Буйрутма черновик катары түзүлдү жана текшерүүгө даяр.",
      "The order is saved as a draft and ready for review.",
    ),
    relatedGuides: [
      "orders/process-order",
      "customers/add-customer",
      "products/add-product",
      "inventory/receiving",
    ],
    troubleshooting: [
      {
        question: t("Товар не находится?", "Товар табылбай жатабы?", "Product not found?"),
        answer: t(
          "Проверьте выбранный магазин, активность товара и его назначение этой точке.",
          "Тандалган дүкөндү, товардын активдүүлүгүн жана бул чекитке дайындалышын текшериңиз.",
          "Check the selected store, whether the product is active, and whether it is assigned to that location.",
        ),
      },
    ],
  },
  {
    slug: "process-order",
    category: "orders",
    title: t(
      "Как обработать заказ клиента",
      "Кардардын буйрутмасын кантип иштетүү керек",
      "How to process a customer order",
    ),
    summary: t(
      "Проведите заказ от черновика до выдачи, не пропуская проверку товаров и клиента.",
      "Товар менен кардарды текшерип, буйрутманы черновиктан берүүгө чейин иштетиңиз.",
      "Move an order from draft to fulfillment while checking its products and customer details.",
    ),
    keywords: t(
      "заказ статус подтвердить готов выдача завершить отменить трекинг",
      "буйрутма статус ырастоо даяр берүү аяктоо жокко чыгаруу трекинг",
      "order status confirm ready fulfill complete cancel tracking",
    ),
    aliases: t(
      "обработать заказ собрать заказ выдать заказ история заказов",
      "буйрутманы иштетүү чогултуу берүү буйрутмалардын тарыхы",
      "process order pick order hand over order order history",
    ),
    roles: ["owner", "manager", "cashier"],
    estimatedMinutes: 5,
    appRoute: "/sales/orders",
    steps: [
      step(
        t("Найдите заказ", "Буйрутманы табыңыз", "Find the order"),
        t(
          "На вкладке «Активные» ищите по номеру, имени, телефону или адресу. При необходимости ограничьте магазин и статус.",
          "«Активдүү» өтмөгүндө номер, ат, телефон же дарек боюнча издеңиз. Зарыл болсо дүкөн менен статусту чектеңиз.",
          "On Active, search by number, name, phone, or address. Narrow by store and status when needed.",
        ),
      ),
      step(
        t("Проверьте черновик", "Черновикти текшериңиз", "Review the draft"),
        t(
          "Откройте заказ и сверьте магазин, клиента, позиции, количество и сумму. В статусах «Черновик» и «Подтвержден» ещё можно изменить клиента и позиции.",
          "Буйрутманы ачып, дүкөндү, кардарды, позицияларды, санды жана сумманы текшериңиз. «Черновик» жана «Ырасталган» статустарында кардар менен позицияларды өзгөртүүгө болот.",
          "Open the order and check its store, customer, lines, quantities, and total. Customer details and lines remain editable in Draft and Confirmed.",
        ),
      ),
      step(
        t("Подтвердите заказ", "Буйрутманы ырастаңыз", "Confirm the order"),
        t(
          "Когда состав согласован, нажмите «Подтвердить». Пустой заказ подтвердить нельзя.",
          "Курамы макулдашылганда «Ырастоо» баскычын басыңыз. Бош буйрутманы ырастоого болбойт.",
          "When the contents are agreed, select Confirm. An empty order cannot be confirmed.",
        ),
      ),
      step(
        t("Отметьте готовность", "Даяр экенин белгилеңиз", "Mark it ready"),
        t(
          "После сборки заказа в статусе «Подтвержден» нажмите «Готов к выдаче».",
          "«Ырасталган» буйрутманы чогулткандан кийин «Берүүгө даяр» баскычын басыңыз.",
          "After picking a Confirmed order, select Ready for pickup.",
        ),
      ),
      step(
        t("Завершите или отмените", "Аяктаңыз же жокко чыгарыңыз", "Complete or cancel"),
        t(
          "ADMIN или MANAGER завершает заказ после выдачи: это списывает товары. Если заказ не будет выполнен, ADMIN или MANAGER может отменить его до завершения.",
          "ADMIN же MANAGER буйрутманы бергенден кийин аяктайт: мында товарлар эсептен чыгарылат. Буйрутма аткарылбаса, ADMIN же MANAGER аны аяктаганга чейин жокко чыгара алат.",
          "After handoff, an ADMIN or MANAGER completes the order, which deducts its products. If it will not be fulfilled, an ADMIN or MANAGER can cancel it before completion.",
        ),
        {
          note: t(
            "Перед завершением ещё раз проверьте магазин и количество: завершённый заказ больше не редактируется.",
            "Аяктоодон мурун дүкөн менен санды дагы бир жолу текшериңиз: аяктаган буйрутма кайра өзгөртүлбөйт.",
            "Recheck the store and quantities before completion; a completed order is no longer editable.",
          ),
        },
      ),
      step(
        t(
          "Добавьте трекинг при доставке",
          "Жеткирүүдө трекинг кошуңуз",
          "Add tracking for delivery",
        ),
        t(
          "Укажите трек-номер, перевозчика, статус и ссылку, затем сохраните. Заказ с добавленным трекингом появится в «Истории». Для отправки письма нужен email клиента.",
          "Трек-номерди, ташуучуну, статусту жана шилтемени көрсөтүп, сактаңыз. Трекинг кошулган буйрутма «Тарыхта» көрүнөт. Кат жөнөтүү үчүн кардардын email'и керек.",
          "Enter the tracking number, carrier, status, and URL, then save. An order with tracking appears in History. Sending tracking email requires a customer email.",
        ),
      ),
    ],
    success: t(
      "Заказ получил правильный статус, а выдача или доставка зафиксирована.",
      "Буйрутма туура статуска өттү, берүү же жеткирүү катталды.",
      "The order has the correct status and its handoff or delivery is recorded.",
    ),
    relatedGuides: [
      "orders/create-order",
      "customers/review-history",
      "reports/analytics-basics",
      "integrations/connect-marketplace",
    ],
    troubleshooting: [
      {
        question: t(
          "Нужной кнопки статуса нет?",
          "Керектүү статус баскычы жокпу?",
          "Status action missing?",
        ),
        answer: t(
          "Проверьте текущий статус. Завершение и отмена доступны только ADMIN и MANAGER.",
          "Учурдагы статусту текшериңиз. Аяктоо жана жокко чыгаруу ADMIN менен MANAGER үчүн гана жеткиликтүү.",
          "Check the current status. Completion and cancellation are available only to ADMIN and MANAGER.",
        ),
      },
    ],
  },
  {
    slug: "add-customer",
    category: "customers",
    title: t("Как добавить клиента", "Кардарды кантип кошуу керек", "How to add a customer"),
    summary: t(
      "Сохраните имя и контакт клиента в базе конкретного магазина.",
      "Кардардын аты менен байланышын белгилүү бир дүкөндүн базасына сактаңыз.",
      "Save a customer's name and contact in one store's customer database.",
    ),
    keywords: t(
      "клиент добавить имя email телефон адрес магазин база",
      "кардар кошуу аты email телефон дарек дүкөн база",
      "customer add name email phone address store database",
    ),
    aliases: t(
      "новый клиент создать контакт записать покупателя",
      "жаңы кардар түзүү байланыш сатып алуучуну каттоо",
      "new customer create contact save buyer",
    ),
    roles: ["owner", "manager"],
    estimatedMinutes: 3,
    appRoute: "/customers?add=1",
    steps: [
      step(
        t("Откройте «Клиентскую базу»", "«Кардарлар базасын» ачыңыз", "Open the customer database"),
        t(
          "В меню «Продажи» выберите «Клиенты».",
          "«Сатуулар» менюсунан «Кардарлар» бөлүмүн тандаңыз.",
          "In the Sales menu, choose Customers.",
        ),
      ),
      step(
        t("Выберите магазин", "Дүкөндү тандаңыз", "Choose the store"),
        t(
          "Клиенты хранятся отдельно по магазинам. Проверьте точку до добавления.",
          "Кардарлар ар бир дүкөн боюнча өзүнчө сакталат. Кошордон мурун чекитти текшериңиз.",
          "Customers are stored separately by store. Verify the location before adding one.",
        ),
      ),
      step(
        t("Нажмите «Добавить клиента»", "«Кардар кошуу» баскычын басыңыз", "Select Add customer"),
        t(
          "На телефоне кнопка находится под фильтрами, на компьютере — в шапке страницы.",
          "Телефондо баскыч фильтрлердин астында, компьютерде барактын башында жайгашкан.",
          "On mobile, the button is below the filters; on desktop, it is in the page header.",
        ),
      ),
      step(
        t("Заполните контакт", "Байланышты толтуруңуз", "Enter contact details"),
        t(
          "Имя обязательно. Также укажите хотя бы email или телефон; адрес можно добавить при необходимости.",
          "Аты милдеттүү. Ошондой эле email же телефондун жок дегенде бирин көрсөтүңүз; даректи зарыл болсо кошсоңуз болот.",
          "Name is required. Also provide at least an email or phone; address is optional.",
        ),
        {
          checklist: [
            t("Имя — обязательно", "Аты — милдеттүү", "Name — required"),
            t(
              "Email или телефон — обязательно",
              "Email же телефон — милдеттүү",
              "Email or phone — required",
            ),
            t("Адрес — по необходимости", "Дарек — зарыл болсо", "Address — optional"),
          ],
        },
      ),
      step(
        t("Сохраните", "Сактаңыз", "Save"),
        t(
          "Проверьте данные и нажмите «Создать клиента».",
          "Маалыматты текшерип, «Кардар түзүү» баскычын басыңыз.",
          "Review the details and select Create customer.",
        ),
      ),
    ],
    success: t(
      "Клиент появился в базе выбранного магазина.",
      "Кардар тандалган дүкөндүн базасында пайда болду.",
      "The customer appears in the selected store's database.",
    ),
    relatedGuides: ["customers/review-history", "orders/create-order", "pos/make-sale"],
    troubleshooting: [
      {
        question: t(
          "Кнопка сохранения недоступна?",
          "Сактоо баскычы жеткиликсизби?",
          "Save action unavailable?",
        ),
        answer: t(
          "Выберите магазин, заполните имя и укажите email или телефон в корректном формате.",
          "Дүкөндү тандап, атын толтуруп, email же телефонду туура форматта көрсөтүңүз.",
          "Choose a store, enter a name, and provide a valid email or phone.",
        ),
      },
    ],
  },
  {
    slug: "review-history",
    category: "customers",
    title: t(
      "Как посмотреть историю клиента",
      "Кардардын тарыхын кантип көрүү керек",
      "How to review customer history",
    ),
    summary: t(
      "Найдите клиента, проверьте контакты, последнюю покупку и недавние завершённые чеки.",
      "Кардарды таап, байланыштарын, акыркы сатып алуусун жана жакындагы аяктаган чектерин текшериңиз.",
      "Find a customer and review contacts, last purchase, and recent completed receipts.",
    ),
    keywords: t(
      "клиент история покупок чеки продажи контакты последняя покупка экспорт",
      "кардар сатып алуу тарыхы чектер сатуу байланыш акыркы сатып алуу экспорт",
      "customer purchase history receipts sales contacts last purchase export",
    ),
    aliases: t(
      "что покупал клиент найти покупателя посмотреть продажи клиента",
      "кардар эмне сатып алган сатып алуучуну табуу кардардын сатууларын көрүү",
      "what did customer buy find buyer view customer sales",
    ),
    roles: ["owner", "manager"],
    estimatedMinutes: 4,
    appRoute: "/customers",
    steps: [
      step(
        t("Выберите магазин", "Дүкөндү тандаңыз", "Choose the store"),
        t(
          "Откройте «Клиенты» и выберите точку, где была покупка. База и история ограничены этим магазином.",
          "«Кардарларды» ачып, сатып алуу болгон чекитти тандаңыз. База менен тарых ошол дүкөн менен чектелет.",
          "Open Customers and choose the location where the purchase occurred. The database and history are scoped to that store.",
        ),
      ),
      step(
        t("Найдите клиента", "Кардарды табыңыз", "Find the customer"),
        t(
          "Ищите по имени, email, телефону или адресу. Фильтр источника отделяет записи, добавленные вручную, импортом, заказом или интеграцией.",
          "Аты, email'и, телефону же дареги боюнча издеңиз. Булак фильтри кол менен, импорт, буйрутма же интеграция аркылуу кошулган жазууларды бөлөт.",
          "Search by name, email, phone, or address. Source separates records added manually, by import, by order, or by integration.",
        ),
      ),
      step(
        t("Откройте «Продажи»", "«Сатууларды» ачыңыз", "Open Sales"),
        t(
          "В строке клиента выберите «Продажи». Откроется карточка с контактами и сводкой.",
          "Кардардын сабынан «Сатууларды» тандаңыз. Байланыштары жана жыйынтыгы бар карточка ачылат.",
          "In the customer row, choose Sales. A detail card opens with contacts and a summary.",
        ),
      ),
      step(
        t("Проверьте историю", "Тарыхты текшериңиз", "Review the history"),
        t(
          "В сводке видны дата последней покупки и число покупок. Ниже показаны до десяти недавних завершённых POS-чеков этого магазина.",
          "Жыйынтыкта акыркы сатып алуунун күнү жана сатып алуулардын саны көрүнөт. Төмөндө бул дүкөндүн акыркы онго чейин аяктаган POS-чектери көрсөтүлөт.",
          "The summary shows the last-purchase date and purchase count. Below it are up to ten recent completed POS receipts from that store.",
        ),
      ),
      step(
        t("Исправьте или экспортируйте", "Оңдоңуз же экспорттоңуз", "Correct or export"),
        t(
          "Из карточки можно открыть редактирование контактов. Для выгрузки базы закройте карточку, нажмите «Экспорт» и выберите CSV или XLSX и нужные колонки. В файл попадут записи текущего магазина и фильтров.",
          "Карточкадан байланыштарды өзгөртүүнү ачсаңыз болот. Базаны жүктөө үчүн карточканы жаап, «Экспорт» баскычын басыңыз жана CSV же XLSX менен керектүү мамычаларды тандаңыз. Файлга учурдагы дүкөндүн жана фильтрлердин жазуулары кирет.",
          "From the card, you can edit contacts. To export the database, close the card, select Export, then choose CSV or XLSX and the columns you need. The file follows the current store and filters.",
        ),
      ),
    ],
    success: t(
      "Контакты и доступная история клиента проверены в нужном магазине.",
      "Кардардын байланыштары жана жеткиликтүү тарыхы керектүү дүкөндө текшерилди.",
      "The customer's contacts and available history are verified in the correct store.",
    ),
    relatedGuides: [
      "customers/add-customer",
      "orders/process-order",
      "reports/analytics-basics",
      "reports/export-reports",
    ],
    troubleshooting: [
      {
        question: t("Почему нет чеков?", "Эмне үчүн чектер жок?", "Why are there no receipts?"),
        answer: t(
          "В карточке показываются завершённые POS-чеки из того же магазина, сопоставленные по email или телефону. Проверьте магазин и контакты.",
          "Карточкада ошол эле дүкөндөгү email же телефон боюнча дал келген аяктаган POS-чектер көрсөтүлөт. Дүкөндү жана байланыштарды текшериңиз.",
          "The card shows completed POS receipts from the same store matched by email or phone. Check the store and contact details.",
        ),
      },
    ],
  },
];
