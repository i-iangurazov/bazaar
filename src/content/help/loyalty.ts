import type { HelpGuide } from "./types";
import { helpText as t } from "./ui";

export const loyaltyGuides: HelpGuide[] = [
  {
    category: "loyalty",
    slug: "get-started",
    title: t(
      "Как запустить бонусную программу Bazaar",
      "Bazaar бонус программасын кантип баштоо керек",
      "How to launch Bazaar loyalty",
    ),
    summary: t(
      "Для владельца: настройте скидку и баллы, разместите QR регистрации и подготовьте кассиров к первой покупке.",
      "Дүкөн ээси үчүн: арзандатууну жана упайларды жөндөңүз, катталуу QR кодун жайгаштырыңыз жана кассирлерди биринчи сатып алууга даярдаңыз.",
      "For owners: set discounts and points, share a registration QR, and prepare cashiers for the first purchase.",
    ),
    keywords: t(
      "бонусы лояльность UDS юдс скидка кешбэк настройки программа клиенты",
      "бонустар лоялдуулук UDS арзандатуу кешбэк жөндөөлөр программа кардарлар",
      "loyalty rewards bonuses UDS discount cashback program settings customers",
    ),
    aliases: t(
      "запустить бонусную программу подключить бонусы как UDS",
      "бонус программасын баштоо бонустарды кошуу UDS",
      "launch loyalty enable rewards like UDS",
    ),
    roles: ["owner", "manager"],
    estimatedMinutes: 8,
    appRoute: "/settings/loyalty",
    steps: [
      {
        title: t(
          "Определите условия для покупателей",
          "Кардарлар үчүн шарттарды аныктаңыз",
          "Choose your customer benefits",
        ),
        body: t(
          "Участник получает скидку на подходящие товары, копит баллы с оплаченной суммы и тратит их при следующих покупках. Регистрация и карта работают в браузере. Покупателю достаточно email; отдельное приложение устанавливать не нужно.",
          "Катышуучу тиешелүү товарларга арзандатуу алат, төлөнгөн суммадан упай топтойт жана аларды кийинки сатып алууларда колдонот. Катталуу жана карта браузерде иштейт. Кардарга email жетиштүү; өзүнчө колдонмо орнотуунун кереги жок.",
          "Members receive a discount on eligible items, earn points on money paid, and redeem them on later purchases. Registration and the card work in a browser. Customers need an email address and do not need to install an app.",
        ),
        note: t(
          "Это собственная бонусная программа Bazaar. Настройки и карты относятся к вашей организации.",
          "Бул Bazaar'дын өзүнүн бонус программасы. Жөндөөлөр жана карталар сиздин уюмга тиешелүү.",
          "This is Bazaar's own loyalty program. Its settings and cards belong to your organization.",
        ),
      },
      {
        title: t(
          "Откройте настройки программы",
          "Программанын жөндөөлөрүн ачыңыз",
          "Open loyalty settings",
        ),
        body: t(
          "Войдите с правами администратора. Откройте «Настройки → Программа лояльности», включите программу и выберите магазины, где она должна работать. После изменения условий нажмите «Сохранить».",
          "Администратор укугу менен кириңиз. «Жөндөөлөр → Лоялдуулук программасы» бөлүмүн ачып, программаны күйгүзүңүз жана иштей турган дүкөндөрдү тандаңыз. Шарттарды өзгөрткөндөн кийин «Сактоо» баскычын басыңыз.",
          "Sign in as an administrator. Open Settings → Loyalty program, enable the program, and select participating stores. Save your changes.",
        ),
        checklist: [
          t(
            "Программа включена и выбран хотя бы один магазин.",
            "Программа күйгүзүлгөн жана жок дегенде бир дүкөн тандалган.",
            "The program is enabled and at least one store is selected.",
          ),
          t(
            "Кассиры имеют доступ к нужным магазинам и кассам.",
            "Кассирлер керектүү дүкөндөргө жана кассаларга кире алышат.",
            "Cashiers have access to the participating stores and registers.",
          ),
        ],
      },
      {
        title: t(
          "Задайте скидку, начисление и лимит списания",
          "Арзандатууну, топтоону жана колдонуу чегин коюңуз",
          "Set the discount, earning rate, and redemption cap",
        ),
        body: t(
          "Скидка участника сразу уменьшает стоимость подходящих товаров. Процент начисления определяет баллы с суммы, оплаченной деньгами после скидок и списания; дробная часть баллов отбрасывается. Максимум оплаты баллами ограничивает долю подходящей суммы после скидки. Минимум списания задаёт порог использования баллов. Время резерва удерживает выбранные баллы за незавершённой покупкой на указанный срок.",
          "Катышуучунун арзандатуусу тиешелүү товарлардын баасын дароо азайтат. Топтоо пайызы арзандатуудан жана упай колдонуудан кийин акча менен төлөнгөн суммадан эсептелет; упайдын бөлчөк бөлүгү алынбайт. Упай менен төлөөнүн эң жогорку пайызы арзандатуудан кийинки тиешелүү сумманын үлүшүн чектейт. Эң аз колдонуу чеги упай колдонуу босогосун белгилейт. Резерв убактысы тандалган упайларды бүтө элек сатып алуу үчүн көрсөтүлгөн мөөнөткө кармайт.",
          "The member discount immediately reduces eligible item prices. The earning rate applies to money paid after discounts and point redemption; fractional points are rounded down. The redemption cap limits the share of the eligible amount after discount that points can cover. Minimum redemption sets the threshold for using points. The reservation time holds selected points for an unfinished purchase for that duration.",
        ),
        note: t(
          "Пример: скидка 5%, начисление 5%, оплата баллами до 50%, 1 балл = 1 сом. Товар за 1 000 сом без списания обойдётся в 950 сом и принесёт 47 баллов после полной оплаты. Это пример условий, а не обязательные настройки.",
          "Мисал: 5% арзандатуу, 5% упай топтоо, 50% чейин упай менен төлөө, 1 упай = 1 сом. 1 000 сомдук товар упай колдонбосо 950 сом болот жана толук төлөгөндөн кийин 47 упай берет. Бул шарттардын мисалы, милдеттүү жөндөө эмес.",
          "Example: 5% discount, 5% earning rate, up to 50% paid with points, and 1 point = 1 som. A 1,000 som item costs 950 som without redemption and earns 47 points after full payment. These are example terms, not required settings.",
        ),
      },
      {
        title: t(
          "Проверьте сочетание с акциями",
          "Акциялар менен айкалышуусун текшериңиз",
          "Review promotional item rules",
        ),
        body: t(
          "Проверьте переключатели исключения акционных товаров и совмещения скидок. По умолчанию акционные товары исключены, а скидки не складываются. Объясните сотрудникам выбранные правила: сумма, доступная для списания, может быть меньше половины всего чека, если в нём есть исключённые позиции.",
          "Акциядагы товарларды алып салуу жана арзандатууларды кошуу которгучтарын текшериңиз. Башында акциядагы товарлар чыгарылган жана арзандатуулар кошулбайт. Кызматкерлерге тандалган эрежелерди түшүндүрүңүз: эгер чекте чыгарылган товарлар болсо, упай менен төлөнүүчү сумма жалпы чектин жарымынан аз болушу мүмкүн.",
          "Review the switches for excluding promotional items and combining discounts. Promotional items are excluded and discounts are not combined by default. Explain your chosen rules to staff: excluded items can make the redeemable amount smaller than half the entire receipt.",
        ),
      },
      {
        title: t(
          "Разместите QR для регистрации",
          "Катталуу QR кодун жайгаштырыңыз",
          "Share the registration QR",
        ),
        body: t(
          "После сохранения найдите карточку нужного магазина в блоке QR регистрации. Откройте страницу и проверьте название магазина и условия. Скачайте QR, разместите его у кассы и скопируйте ссылку для покупателей. Публичный QR приглашает в программу; личный QR на карте покупателя используется на кассе.",
          "Сактагандан кийин катталуу QR бөлүмүнөн керектүү дүкөндүн карточкасын табыңыз. Баракты ачып, дүкөндүн атын жана шарттарын текшериңиз. QR кодун жүктөп, кассанын жанына коюңуз жана кардарлар үчүн шилтемени көчүрүңүз. Жалпы QR программага чакырат; кардардын жеке картасындагы QR кассада колдонулат.",
          "After saving, find the store in the registration QR section. Open its page and check the store name and terms. Download the QR for display at the checkout and copy the link for customers. The public QR invites people to join; the personal QR on a customer's card is used at the register.",
        ),
      },
      {
        title: t(
          "Подготовьте сотрудников и первую покупку",
          "Кызматкерлерди жана биринчи сатып алууну даярдаңыз",
          "Prepare staff for the first purchase",
        ),
        body: t(
          "Пройдите с кассиром следующие инструкции: регистрация покупателя, начисление и списание, возврат. Предложите клиенту: «Откройте QR, подтвердите email и покажите карту — условия и баллы будут в телефоне». При первой реальной покупке сверьте скидку, оплату и историю карты. Затем смотрите использование бонусов в аналитике.",
          "Кассир менен кийинки нускамаларды өтүңүз: кардарды каттоо, упай топтоо жана колдонуу, кайтаруу. Кардарга: «QR кодун ачып, email'ди ырастап, картаны көрсөтүңүз — шарттар жана упайлар телефонуңузда болот» деп сунуштаңыз. Биринчи чыныгы сатып алууда арзандатууну, төлөмдү жана карта тарыхын салыштырыңыз. Андан соң аналитикадан бонустардын колдонулушун караңыз.",
          "Walk cashiers through the linked guides for customer registration, earning and redeeming points, and returns. Invite customers to open the QR, confirm their email, and show their card; terms and points stay on their phone. For the first real purchase, check the discount, payment, and card history. Then review loyalty activity in analytics.",
        ),
      },
    ],
    success: t(
      "Программа сохранена для нужных магазинов, QR доступен покупателям, кассиры знают порядок работы.",
      "Программа керектүү дүкөндөр үчүн сакталды, QR кардарларга жеткиликтүү, кассирлер иштөө тартибин билишет.",
      "The program is saved for participating stores, customers can access the QR, and cashiers know the process.",
    ),
    relatedGuides: [
      "loyalty/customer-card",
      "loyalty/pos-points",
      "loyalty/orders-and-returns",
      "reports/analytics-basics",
    ],
    troubleshooting: [
      {
        question: t(
          "Почему нет QR или бонусов на кассе?",
          "Эмне үчүн QR же кассада бонустар жок?",
          "Why is the QR or POS loyalty option unavailable?",
        ),
        answer: t(
          "Убедитесь, что программа включена, текущий магазин выбран, изменения сохранены и у сотрудника есть доступ к магазину. Новые магазины нужно отдельно включать в программу.",
          "Программа күйгүзүлгөнүн, учурдагы дүкөн тандалганын, өзгөртүүлөр сакталганын жана кызматкер дүкөнгө кире аларын текшериңиз. Жаңы дүкөндөрдү программага өзүнчө кошуу керек.",
          "Check that the program is enabled, the current store is selected, changes are saved, and the employee has store access. Add new stores to the program explicitly.",
        ),
      },
      {
        question: t(
          "Изменение правил пересчитает старые покупки?",
          "Эрежени өзгөртүү эски сатып алууларды кайра эсептейби?",
          "Will changing rules recalculate earlier purchases?",
        ),
        answer: t(
          "Завершённые покупки и возвраты используют условия исходной покупки. Новые правила применяются к новым расчётам. Сообщите покупателям об изменениях до следующей покупки.",
          "Бүткөн сатып алуулар жана кайтаруулар баштапкы сатып алуунун шарттарын колдонот. Жаңы эрежелер жаңы эсептөөлөргө колдонулат. Кийинки сатып алууга чейин кардарларга өзгөрүүлөрдү айтыңыз.",
          "Completed purchases and their returns use the original purchase terms. New rules apply to new calculations. Tell customers about changes before their next purchase.",
        ),
      },
    ],
  },
  {
    category: "loyalty",
    slug: "customer-card",
    title: t(
      "Как покупателю получить и использовать карту",
      "Кардар картаны кантип алат жана колдонот",
      "How customers get and use their card",
    ),
    summary: t(
      "Инструкция, которую можно отправить покупателю: регистрация по email, личный QR, баланс и подтверждение списания.",
      "Кардарга жөнөтүүгө боло турган нускама: email аркылуу катталуу, жеке QR, баланс жана упай колдонууну ырастоо.",
      "Share this guide with customers: email registration, a personal QR, balance, and redemption approval.",
    ),
    keywords: t(
      "карта покупателя регистрация email код QR баланс история клиент",
      "кардар картасы катталуу email код QR баланс тарых",
      "customer card registration email code QR balance history",
    ),
    aliases: t(
      "получить карту зарегистрировать покупателя открыть бонусную карту",
      "карта алуу кардарды каттоо бонус картасын ачуу",
      "get a card register customer open rewards card",
    ),
    roles: ["owner", "manager", "cashier"],
    estimatedMinutes: 4,
    appRoute: "/loyalty/card",
    steps: [
      {
        title: t(
          "Откройте приглашение магазина",
          "Дүкөндүн чакыруусун ачыңыз",
          "Open the store invitation",
        ),
        body: t(
          "Отсканируйте QR регистрации у кассы камерой телефона или откройте ссылку от магазина. Проверьте название магазина, скидку, начисление и ограничения списания. Сохраните ссылку в закладках браузера, чтобы вернуться к карте.",
          "Кассадагы катталуу QR кодун телефондун камерасы менен сканерлеңиз же дүкөндүн шилтемесин ачыңыз. Дүкөндүн атын, арзандатууну, упай топтоону жана колдонуу чектерин текшериңиз. Картага кайтуу үчүн шилтемени браузерге сактаңыз.",
          "Scan the registration QR at the checkout with your phone camera or open the store's link. Check the store name, discount, earning rate, and redemption limits. Bookmark the link to return to your card.",
        ),
      },
      {
        title: t("Подтвердите свой email", "Email дарегиңизди ырастаңыз", "Verify your email"),
        body: t(
          "Введите свой email, запросите код и введите код из письма. Завершите регистрацию по подсказкам страницы. При следующем входе используйте тот же email: карта и история привязаны к нему. Пароль от учётной записи сотрудника для карты не нужен.",
          "Email дарегиңизди киргизип, код сураңыз жана каттагы кодду жазыңыз. Барактагы көрсөтмөлөр менен катталууну бүтүрүңүз. Кийинки кирүүдө ошол эле email'ди колдонуңуз: карта жана тарых ага байланган. Карта үчүн кызматкердин аккаунтунун сырсөзү кереги жок.",
          "Enter your email, request a code, and enter the code from the message. Follow the page prompts to finish registration. Use the same email next time: your card and history are linked to it. You do not need an employee account password.",
        ),
        note: t(
          "Новая карта начинает с нулевого баланса. Баллы появляются после подходящей полностью оплаченной покупки.",
          "Жаңы карта нөлдүк баланс менен башталат. Упайлар тиешелүү сатып алуу толук төлөнгөндөн кийин түшөт.",
          "A new card starts with a zero balance. Points are earned after an eligible purchase is fully paid.",
        ),
      },
      {
        title: t(
          "Покажите личный QR кассиру",
          "Кассирге жеке QR кодуңузду көрсөтүңүз",
          "Show your personal QR to the cashier",
        ),
        body: t(
          "Откройте карту и нажмите «Показать QR кассиру». Кассир сканирует его и проверяет покупателя. QR действует ограниченное время: если он устарел, получите новый на карте. Используйте личный QR своей карты при каждой покупке.",
          "Картаны ачып, «Кассирге QR көрсөтүү» баскычын басыңыз. Кассир аны сканерлеп, кардарды текшерет. QR чектелген убакытка жарактуу: мөөнөтү өтсө картадан жаңысын алыңыз. Ар бир сатып алууда өз картаңыздын жеке QR кодун колдонуңуз.",
          "Open your card and select Show QR to cashier. The cashier scans it and checks the customer. The QR expires after a short time; generate a new one on your card if needed. Use your own card's personal QR for each purchase.",
        ),
      },
      {
        title: t(
          "Выберите, копить или тратить баллы",
          "Упай топтоону же колдонууну тандаңыз",
          "Choose whether to earn or redeem",
        ),
        body: t(
          "Чтобы только копить, попросите кассира не списывать баллы. Для списания согласуйте сумму с кассиром, затем проверьте запрос на своей карте: магазин, покупку, баллы и сумму к оплате. Подтвердите только согласованную покупку. После изменения корзины или суммы списания понадобится новое подтверждение.",
          "Упайды топтоо үчүн кассирден упай колдонбоону сураныңыз. Колдонуу үчүн сумманы кассир менен макулдашып, картадагы суроону текшериңиз: дүкөндү, сатып алууну, упайларды жана төлөм суммасын. Макулдашылган сатып алууну гана ырастаңыз. Себет же колдонулуучу упай өзгөрсө, кайра ырастоо керек.",
          "To earn without redeeming, ask the cashier to use no points. To redeem, agree on the amount, then review the request on your card: store, purchase, points, and money due. Approve the agreed purchase. Changes to the cart or redemption amount require a new approval.",
        ),
        note: t(
          "Показ QR сам по себе не разрешает списание. Подтверждение выполняется на вашей карте.",
          "QR көрсөтүү өзү упай колдонууга уруксат бербейт. Ырастоо өзүңүздүн картаңызда жасалат.",
          "Showing your QR does not authorize redemption. You approve it on your own card.",
        ),
      },
      {
        title: t(
          "Оплатите покупку и проверьте историю",
          "Сатып алууну төлөп, тарыхты текшериңиз",
          "Pay and check your history",
        ),
        body: t(
          "Оплатите оставшуюся сумму и обновите карту. Проверьте начисление, списание и запись покупки. Поле «Доступно» показывает баллы, которые можно использовать сейчас. Часть баланса может временно удерживаться за другим незавершённым чеком или онлайн-заказом; после отмены или окончания резерва она освобождается.",
          "Калган сумманы төлөп, картаны жаңыртыңыз. Топтолгон жана колдонулган упайларды, сатып алуу жазуусун текшериңиз. «Жеткиликтүү» талаасы азыр колдонууга боло турган упайларды көрсөтөт. Баланстын бир бөлүгү башка бүтө элек чек же онлайн буйрутма үчүн убактылуу кармалышы мүмкүн; жокко чыгарылса же резервдин мөөнөтү бүтсө бошотулат.",
          "Pay the remaining amount and refresh your card. Check earned points, redeemed points, and the purchase entry. Available shows points you can use now. Some points may be held for another unfinished receipt or online order; cancellation or reservation expiry releases them.",
        ),
      },
    ],
    success: t(
      "У покупателя есть карта, он умеет показывать QR, подтверждать списание и проверять баланс.",
      "Кардардын картасы бар, ал QR көрсөтүүнү, упай колдонууну ырастоону жана балансты текшерүүнү билет.",
      "The customer has a card and can show their QR, approve redemption, and check their balance.",
    ),
    relatedGuides: ["loyalty/pos-points", "loyalty/orders-and-returns", "loyalty/get-started"],
    troubleshooting: [
      {
        question: t(
          "Код не пришёл или истёк?",
          "Код келген жокпу же мөөнөтү өттүбү?",
          "The code did not arrive or expired?",
        ),
        answer: t(
          "Проверьте email и папку «Спам». Дождитесь возможности повторного запроса и запросите новый код; используйте последнее письмо. Если письма не приходят, сообщите магазину, какой email использовали, не передавая код другим людям.",
          "Email'ди жана «Спам» папкасын текшериңиз. Кайра суроого мүмкүн болгондо жаңы код сураңыз; акыркы катты колдонуңуз. Кат келбесе дүкөнгө колдонгон email'иңизди айтыңыз, кодду башка адамдарга бербеңиз.",
          "Check your email address and spam folder. When another request is allowed, request a new code and use the latest email. If delivery still fails, tell the store which email you used without sharing the code with others.",
        ),
      },
      {
        question: t(
          "Сменили телефон или не видите свои баллы?",
          "Телефонду алмаштырдыңызбы же упайларды көрбөй жатасызбы?",
          "Changed phones or cannot see your points?",
        ),
        answer: t(
          "Откройте ссылку того же магазина и войдите с прежним email. Проверьте название магазина на карте. При расхождении покажите сотруднику дату и номер покупки из истории.",
          "Ошол эле дүкөндүн шилтемесин ачып, мурунку email менен кириңиз. Картадагы дүкөндүн атын текшериңиз. Айырма болсо кызматкерге тарыхтагы сатып алуунун күнүн жана номерин көрсөтүңүз.",
          "Open the same store's link and sign in with your original email. Check the store name on your card. For a discrepancy, show staff the purchase date and reference from your history.",
        ),
      },
    ],
  },
  {
    category: "loyalty",
    slug: "pos-points",
    title: t(
      "Как начислять и списывать баллы на кассе",
      "Кассада упайларды кантип топтоо жана колдонуу керек",
      "How to earn and redeem points at the POS",
    ),
    summary: t(
      "Для кассира: найдите карту, проверьте расчёт, получите подтверждение покупателя и завершите оплату.",
      "Кассир үчүн: картаны таап, эсепти текшерип, кардардын ырастоосун алып, төлөмдү бүтүрүңүз.",
      "For cashiers: find the card, review the calculation, obtain customer approval, and complete payment.",
    ),
    keywords: t(
      "касса бонусы начисление списание баллы согласие QR оплата",
      "касса бонустар топтоо колдонуу упайлар макулдук QR төлөм",
      "POS cashier rewards earn redeem points consent QR payment",
    ),
    aliases: t(
      "списать баллы начислить бонусы оплатить баллами",
      "упай колдонуу бонус топтоо упай менен төлөө",
      "redeem points earn bonuses pay with points",
    ),
    roles: ["cashier", "manager", "owner"],
    estimatedMinutes: 6,
    appRoute: "/pos/sell",
    steps: [
      {
        title: t("Соберите корзину", "Себетти толтуруңуз", "Prepare the cart"),
        body: t(
          "Выберите магазин с включённой программой и откройте смену. Добавьте товары, проверьте количество, тип цены и ручные изменения. Завершите редактирование цен до применения бонусов: расчёт зависит от текущего состава корзины.",
          "Программа күйгүзүлгөн дүкөндү тандап, сменаны ачыңыз. Товарларды кошуп, санын, баа түрүн жана кол менен өзгөртүүлөрдү текшериңиз. Бонус колдонуудан мурун бааларды түзөтүүнү бүтүрүңүз: эсеп учурдагы себетке жараша болот.",
          "Select a participating store and open a shift. Add products and check quantities, price mode, and manual changes. Finish editing prices before applying loyalty; the calculation depends on the current cart.",
        ),
      },
      {
        title: t(
          "Найдите покупателя по личному QR",
          "Кардарды жеке QR аркылуу табыңыз",
          "Find the customer using their personal QR",
        ),
        body: t(
          "Откройте выбор покупателя в верхней части кассы и раздел «Бонусы». Если покупатель уже выбран, откройте его редактирование. Попросите показать QR с личной карты, отсканируйте его в окне бонусов и найдите участника. Сверьте покупателя перед применением.",
          "Кассанын жогору жагындагы кардар тандоону жана «Бонустар» бөлүмүн ачыңыз. Кардар тандалган болсо, аны түзөтүүнү ачыңыз. Жеке картадан QR көрсөтүүнү сурап, бонус терезесинен сканерлеп, катышуучуну табыңыз. Колдонуудан мурун кардарды салыштырыңыз.",
          "Open the customer selector at the top of the POS and the Bonuses section. If a customer is already selected, open their edit control. Ask for the QR from their personal card, scan it in the loyalty window, and find the member. Verify the customer before applying.",
        ),
      },
      {
        title: t(
          "Объясните сумму и выберите баллы",
          "Сумманы түшүндүрүп, упайларды тандаңыз",
          "Explain the total and choose points",
        ),
        body: t(
          "Проверьте исходную сумму, скидку участника, доступные баллы, максимум списания, итог к оплате и ожидаемое начисление. Для накопления укажите 0 к списанию. Для использования баллов согласуйте число в пределах показанного максимума. При изменении скидок и состава корзины ориентируйтесь на новый расчёт Bazaar.",
          "Баштапкы сумманы, катышуучунун арзандатуусун, жеткиликтүү упайларды, колдонуу чегин, төлөмдү жана күтүлгөн топтоону текшериңиз. Топтоо үчүн колдонууга 0 жазыңыз. Упай колдонууда көрсөтүлгөн чектеги санды макулдашыңыз. Арзандатуу же себет өзгөрсө, Bazaar'дын жаңы эсебин колдонуңуз.",
          "Check the original amount, member discount, available points, redemption maximum, money due, and expected earnings. Enter 0 to earn without redeeming. Agree on a redemption amount within the displayed limit. When discounts or cart contents change, use Bazaar's refreshed calculation.",
        ),
        note: t(
          "Пример без акций: товар 1 000 сом, скидка 5%, начисление 5%, лимит 50%, баланс 1 000 баллов. После скидки — 950 сом; можно списать 475 баллов, оплатить 475 сом и получить 23 балла. Новый баланс — 548 баллов при отсутствии других операций.",
          "Акциясыз мисал: товар 1 000 сом, арзандатуу 5%, топтоо 5%, чек 50%, баланс 1 000 упай. Арзандатуудан кийин — 950 сом; 475 упай колдонуп, 475 сом төлөп, 23 упай алууга болот. Башка операция жок болсо жаңы баланс — 548 упай.",
          "Example without promotions: a 1,000 som item, 5% discount, 5% earning rate, 50% cap, and a 1,000-point balance. After discount the total is 950 som; redeem 475 points, pay 475 som, and earn 23 points. The new balance is 548 points if there are no other transactions.",
        ),
      },
      {
        title: t(
          "Получите подтверждение покупателя",
          "Кардардын ырастоосун алыңыз",
          "Get customer approval",
        ),
        body: t(
          "При списании отправьте запрос на подтверждение из окна бонусов. Покупатель открывает свою карту и подтверждает именно эту покупку и количество баллов. Дождитесь подтверждения и примените бонусы. Если запрос истёк или корзина изменилась, отправьте новый запрос с актуальным расчётом.",
          "Упай колдонууда бонус терезесинен ырастоо суроосун жөнөтүңүз. Кардар өз картасын ачып, ушул сатып алууну жана упай санын ырастайт. Ырастоону күтүп, бонустарды колдонуңуз. Суроонун мөөнөтү өтсө же себет өзгөрсө, жаңы эсеп менен кайра сураңыз.",
          "For redemption, send an approval request from the loyalty window. The customer opens their card and approves this purchase and point amount. Wait for approval and apply loyalty. If the request expires or the cart changes, send a new request with the updated calculation.",
        ),
      },
      {
        title: t(
          "Примите деньги и завершите чек",
          "Акчаны кабыл алып, чекти бүтүрүңүз",
          "Take payment and complete the receipt",
        ),
        body: t(
          "Вернувшись в корзину, сверьте итог и перейдите к оплате. Примите оставшуюся сумму выбранным способом и завершите чек. Списанные баллы не являются оплатой наличными или картой. Начисление появляется после полной оплаты; незавершённый или отложенный чек сам по себе баллов не начисляет.",
          "Себетке кайтып, жыйынтыкты салыштырып, төлөмгө өтүңүз. Калган сумманы тандалган ыкма менен алып, чекти бүтүрүңүз. Колдонулган упайлар накталай же карта төлөмү болуп эсептелбейт. Упай толук төлөгөндөн кийин түшөт; бүтпөгөн же жылдырылган чек өзү упай бербейт.",
          "Back in the cart, verify the total and proceed to payment. Collect the remaining amount using the selected method and complete the receipt. Redeemed points are not cash or card payments. Points are earned after full payment; an unfinished or held receipt does not itself earn points.",
        ),
      },
      {
        title: t(
          "Сверьте результат с покупателем",
          "Жыйынтыкты кардар менен салыштырыңыз",
          "Check the result with the customer",
        ),
        body: t(
          "Попросите покупателя обновить карту и проверить запись покупки. Для повторного обращения используйте номер чека и историю карты. Если покупка отменяется, отмените чек обычным действием в Bazaar: удержанные баллы освободятся. Не создавайте второй чек только для исправления баланса.",
          "Кардардан картаны жаңыртып, сатып алуу жазуусун текшерүүнү сураңыз. Кайра кайрылганда чек номерин жана карта тарыхын колдонуңуз. Сатып алуу токтотулса, Bazaar'дагы кадимки аракет менен чекти жокко чыгарыңыз: кармалган упайлар бошотулат. Балансты оңдоо үчүн гана экинчи чек түзбөңүз.",
          "Ask the customer to refresh their card and check the purchase entry. Use the receipt reference and card history for later questions. If the purchase is cancelled, cancel the receipt through Bazaar to release held points. Do not create a second receipt just to correct the balance.",
        ),
      },
    ],
    success: t(
      "Чек оплачен, скидка и списание учтены, покупатель видит начисление и остаток баллов.",
      "Чек төлөндү, арзандатуу жана колдонулган упайлар эске алынды, кардар топтолгон упайларды жана калдыкты көрөт.",
      "The receipt is paid, discounts and redemption are recorded, and the customer can see earnings and their remaining points.",
    ),
    relatedGuides: [
      "loyalty/customer-card",
      "loyalty/orders-and-returns",
      "pos/make-sale",
      "pos/return-sale",
    ],
    troubleshooting: [
      {
        question: t(
          "Баллы есть, но списание недоступно?",
          "Упай бар, бирок колдонууга болбой жатабы?",
          "There are points, but redemption is unavailable?",
        ),
        answer: t(
          "Проверьте доступный баланс, минимум списания, лимит покупки и исключённые акционные товары. Другой незавершённый чек может удерживать баллы. Если расчёт изменился, обновите бонусы и повторите подтверждение покупателя.",
          "Жеткиликтүү балансты, эң аз колдонуу чегин, сатып алуу чегин жана чыгарылган акция товарларын текшериңиз. Башка бүтө элек чек упайларды кармап турушу мүмкүн. Эсеп өзгөрсө, бонустарды жаңыртып, кардардын ырастоосун кайталаңыз.",
          "Check the available balance, minimum redemption, purchase cap, and excluded promotional items. Another unfinished receipt may be holding points. If the calculation changed, refresh loyalty and obtain customer approval again.",
        ),
      },
      {
        question: t(
          "После оплаты баллы не появились?",
          "Төлөгөндөн кийин упай түшкөн жокпу?",
          "No points after payment?",
        ),
        answer: t(
          "Проверьте, что к чеку применена нужная карта, чек завершён и полностью оплачен. Начисление может быть нулевым из-за правил акций или округления вниз. Обновите карту; при расхождении передайте менеджеру номер чека и ожидаемый расчёт.",
          "Чекке керектүү карта колдонулганын, чек бүткөнүн жана толук төлөнгөнүн текшериңиз. Акция эрежелеринен же төмөн тегеректөөдөн улам топтоо нөл болушу мүмкүн. Картаны жаңыртыңыз; айырма болсо менеджерге чек номерин жана күтүлгөн эсепти бериңиз.",
          "Check that the correct card was applied and the receipt is completed and fully paid. Promotional rules or rounding down can result in zero earnings. Refresh the card; if the discrepancy remains, give the manager the receipt reference and expected calculation.",
        ),
      },
    ],
  },
  {
    category: "loyalty",
    slug: "orders-and-returns",
    title: t(
      "Бонусы в онлайн-заказах и возвратах",
      "Онлайн буйрутмалардагы жана кайтаруулардагы бонустар",
      "Loyalty in online orders and returns",
    ),
    summary: t(
      "Как учитывать оплату онлайн-заказа, возвращать деньги и баллы, объяснять изменения баланса и проверять отчёты.",
      "Онлайн буйрутманын төлөмүн эсепке алуу, акча жана упай кайтаруу, баланстын өзгөрүшүн түшүндүрүү жана отчётторду текшерүү.",
      "Record online order payments, refund money and points, explain balance changes, and check reports.",
    ),
    keywords: t(
      "онлайн заказ бонусы возврат частичный баллы оплата история отчёт",
      "онлайн буйрутма бонустар кайтаруу жарым-жартылай упай төлөм тарых отчёт",
      "online order loyalty refund partial return points payment history report",
    ),
    aliases: t(
      "вернуть баллы возврат бонусов бонусы онлайн отрицательный баланс",
      "упай кайтаруу бонустарды кайтаруу онлайн бонус терс баланс",
      "refund points return rewards online loyalty negative balance",
    ),
    roles: ["owner", "manager", "cashier"],
    estimatedMinutes: 7,
    appRoute: "/orders",
    steps: [
      {
        title: t(
          "Покупатель применяет бонусы в каталоге",
          "Кардар каталогдо бонустарды колдонот",
          "The customer applies loyalty in the catalog",
        ),
        body: t(
          "Покупатель входит в свою карту и открывает публичный каталог магазина. При оформлении заказа он проверяет скидку и доступные баллы, выбирает списание и подтверждает заказ. Выбранные баллы временно резервируются. Если программа не включена для этого магазина, бонусные условия в заказе недоступны.",
          "Кардар өз картасына кирип, дүкөндүн жалпы каталогун ачат. Буйрутма түзүүдө арзандатууну жана жеткиликтүү упайларды текшерип, колдонууну тандап, буйрутманы ырастайт. Тандалган упайлар убактылуу резервделет. Бул дүкөндө программа күйгүзүлбөсө, буйрутмада бонус шарттары жеткиликсиз.",
          "The customer signs in to their card and opens the store's public catalog. At checkout they review the discount and available points, choose redemption, and confirm the order. Selected points are temporarily reserved. Loyalty is unavailable if the program is not enabled for that store.",
        ),
      },
      {
        title: t(
          "Зафиксируйте фактически полученную оплату",
          "Чынында алынган төлөмдү каттаңыз",
          "Record the payment actually received",
        ),
        body: t(
          "Сотрудник обрабатывает заказ в разделе заказов и завершает его обычным порядком. В завершённом заказе откройте оплату, выберите кассу с открытой сменой, способ и фактически полученную сумму. Проверьте остаток к оплате перед подтверждением. При частичной оплате начисление ждёт полного погашения.",
          "Кызматкер буйрутмалар бөлүмүндө буйрутманы кадимки тартипте бүтүрөт. Бүткөн буйрутмада төлөмдү ачып, ачык сменалуу кассаны, ыкманы жана чындап алынган сумманы тандаңыз. Ырастоодон мурун төлөнө турган калдыкты текшериңиз. Жарым-жартылай төлөмдө упай толук төлөнгөнгө чейин түшпөйт.",
          "Staff process and complete the order through the normal order workflow. In the completed order, open payment and select a register with an open shift, the payment method, and the amount actually received. Check the outstanding balance before confirming. Partial payments do not earn points until the order is fully paid.",
        ),
        note: t(
          "Создание или завершение заказа само по себе не подтверждает получение денег. Записывайте оплату после её фактического получения.",
          "Буйрутманы түзүү же бүтүрүү өзү акча алынганын ырастабайт. Төлөмдү чындап алгандан кийин гана каттаңыз.",
          "Creating or completing an order does not confirm that money was received. Record payment after you actually receive it.",
        ),
      },
      {
        title: t(
          "Оформляйте возврат из исходной покупки",
          "Кайтарууну баштапкы сатып алуудан түзүңүз",
          "Start the return from the original purchase",
        ),
        body: t(
          "Для кассовой продажи найдите исходный чек в журнале чеков и откройте возврат. Для онлайн-покупки откройте возврат из соответствующего заказа. Выберите возвращаемые товары и количество, проверьте рассчитанную сумму денег и подтвердите возврат. При частичном возврате оставшиеся товары сохраняются в покупке.",
          "Кассадагы сатуу үчүн чек журналынан баштапкы чекти таап, кайтарууну ачыңыз. Онлайн сатып алуу үчүн тиешелүү буйрутмадан кайтарууну ачыңыз. Кайтарылуучу товарларды жана санын тандап, эсептелген акча суммасын текшерип, кайтарууну ырастаңыз. Жарым-жартылай кайтарууда калган товарлар сатып алууда калат.",
          "For a POS sale, find the original receipt in receipt history and open a return. For an online purchase, start the return from the corresponding order. Select returned items and quantities, review the calculated money refund, and confirm. A partial return leaves the remaining items in the purchase.",
        ),
        note: t(
          "Верните деньги покупателю соответствующим способом и учтите их в Bazaar. Запись возврата сама по себе не отправляет банковский перевод.",
          "Кардарга акчаны тиешелүү ыкма менен кайтарып, Bazaar'да эсепке алыңыз. Кайтаруу жазуусу өзү банктык которуу жөнөтпөйт.",
          "Return the money using the appropriate method and record it in Bazaar. A return record does not itself send a bank transfer.",
        ),
      },
      {
        title: t(
          "Проверьте восстановление и отмену баллов",
          "Упайдын калыбына келишин жана алынышын текшериңиз",
          "Check restored and reversed points",
        ),
        body: t(
          "При возврате Bazaar восстанавливает потраченные на возвращаемые товары баллы и отменяет начисленные за них баллы. Частичный возврат учитывает возвращённую долю и уже сделанные возвраты. Расчёт берётся из исходной покупки, даже если настройки программы позже изменились.",
          "Кайтарууда Bazaar кайтарылган товарларга колдонулган упайларды калыбына келтирет жана алар үчүн топтолгон упайларды алып салат. Жарым-жартылай кайтарууда кайтарылган үлүш жана мурунку кайтаруулар эске алынат. Программанын жөндөөлөрү кийин өзгөрсө да, эсеп баштапкы сатып алуудан алынат.",
          "On return, Bazaar restores points redeemed for the returned items and reverses the points earned on them. Partial returns account for the returned share and earlier returns. Calculations use the original purchase terms even if program settings changed later.",
        ),
        note: t(
          "Пример полного возврата: покупатель списал 475 баллов, заплатил 475 сом и получил 23 балла. Возврат возвращает 475 сом, восстанавливает 475 баллов и убирает 23 начисленных. Баланс 548 снова станет 1 000, если других операций не было.",
          "Толук кайтаруунун мисалы: кардар 475 упай колдонуп, 475 сом төлөп, 23 упай алган. Кайтарууда 475 сом берилет, 475 упай калыбына келет жана топтолгон 23 упай алынат. Башка операция жок болсо, 548 баланс кайра 1 000 болот.",
          "Full return example: the customer redeemed 475 points, paid 475 som, and earned 23 points. The return refunds 475 som, restores 475 points, and reverses the 23 earned points. A balance of 548 returns to 1,000 if no other transactions occurred.",
        ),
      },
      {
        title: t(
          "Объясните отрицательный или удержанный баланс",
          "Терс же кармалган балансты түшүндүрүңүз",
          "Explain negative or held balances",
        ),
        body: t(
          "Если покупатель успел потратить начисленные баллы до возврата, после отмены начисления учётный баланс может стать отрицательным. Доступно к списанию будет 0; это не денежный долг покупателя. Если баллы удержаны незавершённым заказом, проверьте его статус: отмена или истечение резерва освобождает удержание.",
          "Кардар кайтарууга чейин топтолгон упайларды колдонуп койсо, топтоо алынгандан кийин эсептик баланс терс болушу мүмкүн. Колдонууга 0 жеткиликтүү болот; бул кардардын акчалай карызы эмес. Упайлар бүтө элек буйрутмада кармалса, анын абалын текшериңиз: жокко чыгаруу же резерв мөөнөтүнүн бүтүшү кармоону бошотот.",
          "If the customer already spent the earned points before a return, reversing those earnings can make the recorded balance negative. Available redemption becomes 0; this is not a cash debt. If an unfinished order holds points, check its status: cancellation or reservation expiry releases the hold.",
        ),
      },
      {
        title: t(
          "Сверьте историю и отчёты",
          "Тарыхты жана отчётторду салыштырыңыз",
          "Reconcile history and reports",
        ),
        body: t(
          "Попросите покупателя обновить историю карты. Сверьте номер покупки, оплату, возврат и изменения баллов. В аналитике выберите тот же магазин и период, проверьте онлайн-продажи и активность бонусов. Деньги, скидка и баллы — разные показатели: не прибавляйте списанные баллы к денежной выручке.",
          "Кардардан карта тарыхын жаңыртууну сураныңыз. Сатып алуу номерин, төлөмдү, кайтарууну жана упай өзгөрүүлөрүн салыштырыңыз. Аналитикадан ошол эле дүкөндү жана мезгилди тандап, онлайн сатууларды жана бонус аракеттерин текшериңиз. Акча, арзандатуу жана упайлар ар башка көрсөткүчтөр: колдонулган упайларды акчалай кирешеге кошпоңуз.",
          "Ask the customer to refresh their card history. Match the purchase reference, payment, return, and point changes. In analytics, select the same store and period and review online sales and loyalty activity. Money, discounts, and points are separate measures: do not add redeemed points to cash revenue.",
        ),
      },
    ],
    success: t(
      "Оплаты и возвраты записаны по исходной покупке, деньги и баллы сверены с историей и отчётами.",
      "Төлөмдөр жана кайтаруулар баштапкы сатып алуу боюнча катталды, акча жана упайлар тарых жана отчёттор менен салыштырылды.",
      "Payments and returns are linked to the original purchase, and money and points match history and reports.",
    ),
    relatedGuides: [
      "loyalty/pos-points",
      "loyalty/customer-card",
      "pos/return-sale",
      "reports/analytics-basics",
    ],
    troubleshooting: [
      {
        question: t(
          "Заказ завершён, а начисления нет?",
          "Буйрутма бүттү, бирок упай түшкөн жокпу?",
          "The order is complete but points were not earned?",
        ),
        answer: t(
          "Проверьте полную оплату, карту участника и участие товаров в программе. Если платёж уже записан, обновите заказ и карту перед повторными действиями, чтобы не внести деньги дважды.",
          "Толук төлөмдү, катышуучунун картасын жана товарлардын программага киришин текшериңиз. Төлөм катталган болсо, акчаны эки жолу киргизбөө үчүн кайра аракеттенүүдөн мурун буйрутманы жана картаны жаңыртыңыз.",
          "Check full payment, the member card, and item eligibility. If payment is already recorded, refresh the order and card before retrying to avoid recording money twice.",
        ),
      },
      {
        question: t(
          "Почему возврат меньше исходной цены товара?",
          "Эмне үчүн кайтаруу товардын баштапкы баасынан аз?",
          "Why is the refund below the item's original price?",
        ),
        answer: t(
          "Возвращается денежная часть с учётом скидок, списанных баллов, количества и предыдущих возвратов. Потраченные баллы восстанавливаются отдельно. Сравнивайте с деталями исходной покупки и рассчитанным возвратом.",
          "Арзандатуу, колдонулган упай, сан жана мурунку кайтаруулар эске алынган акчалай бөлүк кайтарылат. Колдонулган упайлар өзүнчө калыбына келет. Баштапкы сатып алуунун чоо-жайы жана эсептелген кайтаруу менен салыштырыңыз.",
          "The money refund accounts for discounts, redeemed points, quantities, and previous returns. Redeemed points are restored separately. Compare against the original purchase details and the calculated return.",
        ),
      },
    ],
  },
];
