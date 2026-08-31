import type { HelpGuide, HelpRole, HelpStep, HelpStepGuidance, LocalizedText } from "./types";
import { helpText as t } from "./ui";

type StepAudit = HelpStepGuidance & {
  title?: LocalizedText;
  body?: LocalizedText;
  keepMedia?: boolean;
};

type GuideAudit = {
  roles?: HelpRole[];
  appRoute?: string;
  summary?: LocalizedText;
  success?: LocalizedText;
  steps: StepAudit[];
};

const auditedStep = (
  location: LocalizedText,
  control: LocalizedText,
  result: LocalizedText,
  replacement: Pick<StepAudit, "title" | "body" | "keepMedia"> = {},
): StepAudit => ({ location, control, result, ...replacement });

/**
 * Consequential Guide workflows are kept separate from the general catalog so
 * their route, permission, control, transition, and completion claims can be
 * reviewed together against the application that owns them.
 */
const consequentialGuideAudits: Record<string, GuideAudit> = {
  "products/import-products": {
    roles: ["owner"],
    appRoute: "/settings/import",
    steps: [
      auditedStep(
        t(
          "Товары → Действия → Импорт товаров",
          "Товарлар → Аракеттер → Товарларды импорттоо",
          "Products → Actions → Import products",
        ),
        t(
          "Пункт «Импорт товаров» в меню «Действия»",
          "«Аракеттер» менюсундагы «Товарларды импорттоо» пункту",
          "Import products in the Actions menu",
        ),
        t(
          "Откроется Настройки → Импорт с типом «Товары»; этот тип доступен только администратору.",
          "Жөндөөлөр → Импорт барагы «Товарлар» түрү менен ачылат; бул түр администраторго гана жеткиликтүү.",
          "Settings → Import opens with Products selected; only an administrator can use this type.",
        ),
        { keepMedia: true },
      ),
      auditedStep(
        t(
          "Карточки «Целевой магазин» и «Загрузка файла» на странице импорта",
          "Импорт барагындагы «Максаттуу дүкөн» жана «Файл жүктөө» карточкалары",
          "Target store and Upload file cards on the Import page",
        ),
        t(
          "Список магазина и поле файла .CSV, .XLSX или .XLS",
          "Дүкөн тизмеси жана .CSV, .XLSX же .XLS файл талаасы",
          "Store selector and the .CSV, .XLSX, or .XLS file input",
        ),
        t(
          "Под именем файла появится определённый источник, а ниже — колонки для сопоставления.",
          "Файлдын аталышынын астында аныкталган булак, төмөндө дал келтирүүчү мамычалар чыгат.",
          "The detected source appears below the file name and column mapping becomes available.",
        ),
        {
          body: t(
            "Сначала выберите магазин, затем загрузите CSV, XLSX или XLS: одна строка должна описывать один товар или вариант.",
            "Адегенде дүкөндү тандап, андан кийин CSV, XLSX же XLS жүктөңүз: бир сап бир товарды же вариантты сүрөттөшү керек.",
            "Choose the target store, then upload CSV, XLSX, or XLS; each row should describe one product or variant.",
          ),
        },
      ),
      auditedStep(
        t(
          "Карточка «Сопоставление колонок» под загруженным файлом",
          "Жүктөлгөн файлдын астындагы «Мамычаларды дал келтирүү» карточкасы",
          "Column mapping card below the uploaded file",
        ),
        t(
          "Режим импорта и списки для SKU, названия и единицы измерения",
          "Импорт режими жана SKU, аталыш, өлчөө бирдиги үчүн тизмелер",
          "Import mode and the SKU, Name, and Unit mapping selectors",
        ),
        t(
          "Обязательные поля перестанут подсвечиваться; для полного импорта готовы SKU, название и единица.",
          "Милдеттүү талаалардын эскертүүсү жоголот; толук импорт үчүн SKU, аталыш жана бирдик даяр болот.",
          "Required-field warnings clear; SKU, Name, and Unit are ready for a full import.",
        ),
        {
          body: t(
            "Для полного импорта сопоставьте SKU, название и единицу; цену, штрихкоды, остаток и остальные колонки добавьте при наличии.",
            "Толук импорт үчүн SKU, аталыш жана бирдикти дал келтириңиз; баа, штрихкод, калдык жана башка мамычаларды бар болсо кошуңуз.",
            "For a full import, map SKU, Name, and Unit; map price, barcodes, stock, and other columns when present.",
          ),
        },
      ),
      auditedStep(
        t(
          "Карточки «Предпросмотр» и «Проверка» под сопоставлением",
          "Дал келтирүүнүн астындагы «Алдын ала көрүү» жана «Текшерүү» карточкалары",
          "Preview and Validation cards below mapping",
        ),
        t(
          "Таблица предпросмотра, сухой прогон и действия исправления или пропуска строки",
          "Алдын ала көрүү таблицасы, сыноо текшерүүсү жана сапты оңдоо же өткөрүп жиберүү аракеттери",
          "Preview table, dry run, and the row fix or skip actions",
        ),
        t(
          "Сводка показывает допустимые и ошибочные строки; «Применить импорт» остаётся недоступной при блокирующих ошибках.",
          "Жыйынтык жарактуу жана катасы бар саптарды көрсөтөт; бөгөттөөчү каталарда «Импортту колдонуу» жеткиликсиз калат.",
          "The summary separates valid and invalid rows; Apply import stays disabled while blocking errors remain.",
        ),
        {
          body: t(
            "Проверьте предпросмотр и сухой прогон. Исправьте, очистите или пропустите каждую блокирующую строку до запуска.",
            "Алдын ала көрүүнү жана сыноо текшерүүсүн караңыз. Ишке киргизерден мурун ар бир бөгөттөөчү сапты оңдоңуз, тазалаңыз же өткөрүп жибериңиз.",
            "Review the preview and dry run. Fix, clear, or skip every blocking row before starting the import.",
          ),
        },
      ),
      auditedStep(
        t(
          "Нижняя часть карточки «Проверка»",
          "«Текшерүү» карточкасынын төмөнкү бөлүгү",
          "Bottom of the Validation card",
        ),
        t("Кнопка «Применить импорт»", "«Импортту колдонуу» баскычы", "Apply import button"),
        t(
          "Появится ход импорта, затем блок результата с числом обработанных строк; пакет появится в истории.",
          "Импорттун жүрүшү, андан кийин иштетилген саптардын саны менен жыйынтык блогу чыгат; пакет тарыхка кошулат.",
          "Import progress appears, followed by a result with processed-row counts; the batch is added to history.",
        ),
        {
          body: t(
            "Нажмите «Применить импорт» один раз и дождитесь блока результата; не повторяйте запуск, пока идёт обработка.",
            "«Импортту колдонуу» баскычын бир жолу басып, жыйынтык блогун күтүңүз; иштетүү жүрүп жатканда кайра баштабаңыз.",
            "Select Apply import once and wait for the result card; do not start it again while processing is in progress.",
          ),
        },
      ),
    ],
  },

  "inventory/receiving": {
    roles: ["owner", "manager"],
    steps: [
      auditedStep(
        t(
          "Запасы → Оприходование → карточка «Детали оприходования»",
          "Запастар → Кириштөө → «Кириштөөнүн чоо-жайы» карточкасы",
          "Inventory → Receiving → Receiving details card",
        ),
        t("Список «Магазин»", "«Дүкөн» тизмеси", "Store selector"),
        t(
          "Название выбранной точки появится в сводке; поиск товаров станет доступен для этого магазина.",
          "Тандалган жердин аталышы жыйынтыкта чыгат; ошол дүкөн үчүн товар издөө жеткиликтүү болот.",
          "The selected location appears in the summary and product search is enabled for that store.",
        ),
      ),
      auditedStep(
        t(
          "Карточка поиска товаров под деталями документа",
          "Документтин чоо-жайынын астындагы товар издөө карточкасы",
          "Product search card below the document details",
        ),
        t(
          "Поле поиска по названию, SKU или штрихкоду; выбор строки результата добавляет её",
          "Аталыш, SKU же штрихкод боюнча издөө талаасы; жыйынтык сабын тандоо аны кошот",
          "Name, SKU, or barcode search; selecting a result adds it",
        ),
        t(
          "Товар появится в таблице «Позиции оприходования» с текущим остатком.",
          "Товар учурдагы калдыгы менен «Кириштөө позициялары» таблицасында чыгат.",
          "The product appears in Receiving lines with its current on-hand quantity.",
        ),
      ),
      auditedStep(
        t(
          "Строка товара в таблице «Позиции оприходования»",
          "«Кириштөө позициялары» таблицасындагы товар сабы",
          "Product row in Receiving lines",
        ),
        t(
          "Поля «Количество» и «Себестоимость за единицу»",
          "«Саны» жана «Бирдиктин өздүк наркы» талаалары",
          "Quantity and Unit cost fields",
        ),
        t(
          "В строке пересчитаются сумма и новый остаток, а сводка покажет общие количество и стоимость.",
          "Сапта сумма жана жаңы калдык кайра эсептелет, жыйынтык жалпы сан менен наркты көрсөтөт.",
          "The line total and new stock recalculate, and the summary shows total quantity and cost.",
        ),
      ),
      auditedStep(
        t(
          "Карточка «Сводка оприходования» справа или нижняя панель на телефоне",
          "Оң жактагы «Кириштөө жыйынтыгы» карточкасы же телефондогу төмөнкү панель",
          "Receiving summary card on desktop or bottom action bar on mobile",
        ),
        t(
          "Кнопка «Провести оприходование»",
          "«Кириштөөнү өткөрүү» баскычы",
          "Post receiving button",
        ),
        t(
          "Появится сообщение об успешном оприходовании; остаток и себестоимость изменятся, а движение запишется в журнал.",
          "Ийгиликтүү кириштөө билдирүүсү чыгат; калдык жана өздүк нарк өзгөрүп, кыймыл журналга жазылат.",
          "A receiving-success message appears; stock and cost update and the movement is written to the journal.",
        ),
      ),
    ],
  },

  "inventory/transfer": {
    roles: ["owner", "manager"],
    steps: [
      auditedStep(
        t(
          "Запасы → Перемещение → карточка «Детали перемещения»",
          "Запастар → Которуу → «Которуунун чоо-жайы» карточкасы",
          "Inventory → Transfers → Transfer details card",
        ),
        t(
          "Списки «Магазин-источник» и «Магазин-получатель»",
          "«Булак дүкөн» жана «Алуучу дүкөн» тизмелери",
          "Source store and Destination store selectors",
        ),
        t(
          "Оба разных магазина появятся в сводке; поиск начнёт показывать остаток источника.",
          "Эки башка дүкөн тең жыйынтыкта чыгат; издөө булактагы калдыкты көрсөтө баштайт.",
          "Both distinct stores appear in the summary and search starts showing source stock.",
        ),
      ),
      auditedStep(
        t(
          "Карточка поиска товаров под деталями перемещения",
          "Которуунун чоо-жайынын астындагы товар издөө карточкасы",
          "Product search card below Transfer details",
        ),
        t(
          "Поиск по названию, SKU или штрихкоду и строка результата",
          "Аталыш, SKU же штрихкод боюнча издөө жана жыйынтык сабы",
          "Name, SKU, or barcode search and its result row",
        ),
        t(
          "Выбранный товар добавится в «Позиции перемещения» вместе с остатками источника и получателя.",
          "Тандалган товар булак жана алуучу калдыктары менен «Которуу позицияларына» кошулат.",
          "The selected product is added to Transfer lines with source and destination stock.",
        ),
      ),
      auditedStep(
        t(
          "Строка товара в таблице «Позиции перемещения»",
          "«Которуу позициялары» таблицасындагы товар сабы",
          "Product row in Transfer lines",
        ),
        t("Поле «Количество перемещения»", "«Которуу саны» талаасы", "Transfer quantity field"),
        t(
          "Колонки «После перемещения» пересчитаются для обоих магазинов; превышение остатка заблокирует проведение.",
          "«Которуудан кийин» мамычалары эки дүкөн үчүн кайра эсептелет; калдыкты ашыруу өткөрүүгө бөгөт коёт.",
          "After-transfer values recalculate for both stores; exceeding source stock blocks posting.",
        ),
      ),
      auditedStep(
        t(
          "Карточка «Сводка перемещения» справа или нижняя панель на телефоне",
          "Оң жактагы «Которуу жыйынтыгы» карточкасы же телефондогу төмөнкү панель",
          "Transfer summary card on desktop or bottom action bar on mobile",
        ),
        t("Кнопка «Провести перемещение»", "«Которууну өткөрүү» баскычы", "Post transfer button"),
        t(
          "Появится сообщение об успешном перемещении; парные движения одновременно обновят оба магазина.",
          "Ийгиликтүү которуу билдирүүсү чыгат; жуп кыймылдар эки дүкөндү бир убакта жаңыртат.",
          "A transfer-success message appears and paired movements update both stores together.",
        ),
      ),
    ],
  },

  "inventory/write-off": {
    roles: ["owner", "manager"],
    steps: [
      auditedStep(
        t(
          "Запасы → Списание → карточка «Детали списания»",
          "Запастар → Эсептен чыгаруу → «Эсептен чыгаруунун чоо-жайы» карточкасы",
          "Inventory → Write-offs → Write-off details card",
        ),
        t("Список «Магазин»", "«Дүкөн» тизмеси", "Store selector"),
        t(
          "Выбранная точка появится в сводке, а поиск ограничится её остатками.",
          "Тандалган жер жыйынтыкта чыгат, издөө анын калдыктары менен чектелет.",
          "The selected location appears in the summary and search is scoped to its stock.",
        ),
      ),
      auditedStep(
        t(
          "Карточка поиска под деталями списания",
          "Эсептен чыгаруунун чоо-жайынын астындагы издөө карточкасы",
          "Search card below Write-off details",
        ),
        t(
          "Поиск по названию, SKU или штрихкоду и строка нужного варианта",
          "Аталыш, SKU же штрихкод боюнча издөө жана керектүү варианттын сабы",
          "Name, SKU, or barcode search and the required variant result",
        ),
        t(
          "Позиция добавится в таблицу с текущим остатком и полем количества списания.",
          "Позиция учурдагы калдык жана эсептен чыгаруу саны талаасы менен таблицага кошулат.",
          "The item is added with current stock and a write-off quantity field.",
        ),
      ),
      auditedStep(
        t(
          "Карточка «Детали списания», затем строка товара",
          "«Эсептен чыгаруунун чоо-жайы» карточкасы, андан кийин товар сабы",
          "Write-off details card, then the product row",
        ),
        t(
          "Обязательный список «Причина», необязательный комментарий и поле «Количество»",
          "Милдеттүү «Себеп» тизмеси, кошумча комментарий жана «Саны» талаасы",
          "Required Reason selector, optional Comment, and Quantity field",
        ),
        t(
          "В строке появится остаток после списания; сводка покажет причину и итоговое количество.",
          "Сапта эсептен чыгаргандан кийинки калдык чыгат; жыйынтык себепти жана жалпы санды көрсөтөт.",
          "The row shows stock after write-off and the summary shows the reason and total quantity.",
        ),
        {
          body: t(
            "Выберите причину, при необходимости добавьте комментарий и укажите количество для каждой позиции.",
            "Себепти тандап, керек болсо комментарий кошуп, ар бир позиция үчүн санын көрсөтүңүз.",
            "Choose a reason, add an optional comment, and enter the quantity for each item.",
          ),
        },
      ),
      auditedStep(
        t(
          "Карточка «Сводка списания» справа или нижняя панель на телефоне",
          "Оң жактагы «Эсептен чыгаруу жыйынтыгы» карточкасы же телефондогу төмөнкү панель",
          "Write-off summary card on desktop or bottom action bar on mobile",
        ),
        t(
          "Кнопка «Провести списание»",
          "«Эсептен чыгарууну өткөрүү» баскычы",
          "Post write-off button",
        ),
        t(
          "Появится сообщение об успешном списании; остаток уменьшится, а автор и причина сохранятся в движении.",
          "Ийгиликтүү эсептен чыгаруу билдирүүсү чыгат; калдык азайып, автор менен себеп кыймылда сакталат.",
          "A write-off-success message appears; stock decreases and the actor and reason are stored on the movement.",
        ),
      ),
    ],
  },

  "inventory/inventory-count": {
    roles: ["owner", "manager"],
    steps: [
      auditedStep(
        t(
          "Запасы → Инвентаризация, над списком пересчётов",
          "Запастар → Инвентаризация, кайра саноолор тизмесинин үстү",
          "Inventory → Stock counts, above the count list",
        ),
        t(
          "Список магазина, кнопка «Создать пересчёт» и поле «Примечание» в окне",
          "Дүкөн тизмеси, «Кайра саноо түзүү» баскычы жана терезедеги «Эскертүү» талаасы",
          "Store selector, Create stock count button, and Notes field in the dialog",
        ),
        t(
          "Откроется страница нового пересчёта с кодом, выбранным магазином и статусом черновика.",
          "Коду, тандалган дүкөнү жана черновик статусу бар жаңы кайра саноо барагы ачылат.",
          "A new count page opens with its code, selected store, and draft status.",
        ),
        {
          body: t(
            "Выберите магазин, нажмите «Создать пересчёт», добавьте понятное примечание и подтвердите создание.",
            "Дүкөндү тандап, «Кайра саноо түзүү» баскычын басыңыз, түшүнүктүү эскертүү кошуп, түзүүнү ырастаңыз.",
            "Choose a store, select Create stock count, add a clear note, and confirm creation.",
          ),
        },
      ),
      auditedStep(
        t(
          "Карточка «Сканирование» на странице пересчёта",
          "Кайра саноо барагындагы «Сканерлөө» карточкасы",
          "Scan card on the stock-count detail page",
        ),
        t(
          "Поле сканирования; для ручной правки — действие «Изменить подсчитанное» в строке",
          "Сканерлөө талаасы; кол менен оңдоо үчүн саптагы «Саналганды өзгөртүү» аракети",
          "Scan input; for a manual correction, Edit counted on the line",
        ),
        t(
          "Товар появится в «Позициях»; сохранённое фактическое количество обновит колонки «Подсчитано» и «Разница».",
          "Товар «Позицияларда» чыгат; сакталган чыныгы сан «Саналган» жана «Айырма» мамычаларын жаңыртат.",
          "The item appears under Lines; the saved physical quantity updates Counted and Delta.",
        ),
      ),
      auditedStep(
        t(
          "Таблица «Позиции» и карточка «Сводка» справа",
          "«Позициялар» таблицасы жана оң жактагы «Жыйынтык» карточкасы",
          "Lines table and Summary card on the right",
        ),
        t(
          "Колонки «Ожидалось», «Подсчитано», «Разница» и счётчики излишков/недостач",
          "«Күтүлгөн», «Саналган», «Айырма» мамычалары жана ашыкча/жетишпеген эсептегичтер",
          "Expected, Counted, and Delta columns plus overage and shortage counters",
        ),
        t(
          "Все крупные расхождения объяснены или исправлены; число строк с расхождением соответствует проверке.",
          "Бардык чоң айырмалар түшүндүрүлгөн же оңдолгон; айырмасы бар саптардын саны текшерүүгө туура келет.",
          "Every material variance is explained or corrected and the variance-line count matches the review.",
        ),
      ),
      auditedStep(
        t(
          "Верхняя панель страницы пересчёта",
          "Кайра саноо барагынын жогорку панели",
          "Top action bar of the stock-count detail page",
        ),
        t(
          "Кнопка «Применить» и опасное окно подтверждения",
          "«Колдонуу» баскычы жана кооптуу ырастоо терезеси",
          "Apply button and its destructive confirmation dialog",
        ),
        t(
          "Статус станет «Применено», поля заблокируются, а корректирующие движения появятся для излишков и недостач.",
          "Статус «Колдонулду» болуп, талаалар бөгөттөлөт жана ашыкча/жетишпеген үчүн түзөтүүчү кыймылдар чыгат.",
          "Status changes to Applied, editing locks, and adjustment movements appear for overages and shortages.",
        ),
      ),
    ],
  },

  "pos/open-shift": {
    roles: ["owner", "manager", "cashier", "stockkeeper"],
    steps: [
      auditedStep(
        t("Касса → обзор POS", "Касса → POS сереби", "POS → overview"),
        t(
          "Список «Выберите кассу»; в варианте указаны магазин, название и код кассы",
          "«Кассаны тандаңыз» тизмеси; вариантта дүкөн, кассанын аталышы жана коду көрсөтүлөт",
          "Select register list; each option shows store, register name, and code",
        ),
        t(
          "На карточке появятся выбранная касса и статус «Смена закрыта» с доступной кнопкой открытия.",
          "Карточкада тандалган касса жана ачуу баскычы менен «Смена жабык» статусу чыгат.",
          "The card shows the selected register and Shift closed, with the open action enabled.",
        ),
      ),
      auditedStep(
        t(
          "Окно «Открыть смену» после нажатия одноимённой кнопки",
          "Ушул аталыштагы баскычтан кийинки «Сменаны ачуу» терезеси",
          "Open shift dialog after selecting the button of the same name",
        ),
        t(
          "Поле «Начальная сумма»; необязательно — «Примечание к открытию»",
          "«Баштапкы сумма» талаасы; кошумча — «Ачуу эскертүүсү»",
          "Opening cash field and optional Opening note",
        ),
        t(
          "Введённая неотрицательная сумма останется в окне и будет готова к подтверждению.",
          "Киргизилген терс эмес сумма терезеде калып, ырастоого даяр болот.",
          "The non-negative opening amount remains in the dialog ready for confirmation.",
        ),
      ),
      auditedStep(
        t(
          "Нижняя часть окна «Открыть смену»",
          "«Сменаны ачуу» терезесинин төмөнкү бөлүгү",
          "Footer of the Open shift dialog",
        ),
        t(
          "Основная кнопка «Открыть смену»",
          "Негизги «Сменаны ачуу» баскычы",
          "Primary Open shift button",
        ),
        t(
          "Появится сообщение об открытии смены, и Bazaar автоматически перейдёт на `/pos/sell` для этой кассы.",
          "Смена ачылганы тууралуу билдирүү чыгып, Bazaar бул касса үчүн `/pos/sell` барагына автоматтык өтөт.",
          "An open-shift confirmation appears and Bazaar redirects to `/pos/sell` for that register.",
        ),
      ),
    ],
  },

  "pos/make-sale": {
    roles: ["owner", "manager", "cashier", "stockkeeper"],
    steps: [
      auditedStep(
        t(
          "Касса → Продажа, каталог слева (на телефоне — вкладка «Документ» → «Добавить товары»)",
          "Касса → Сатуу, сол жактагы каталог (телефондо — «Документ» → «Товар кошуу»)",
          "POS → Sell, catalog on the left (on mobile, Document → Add products)",
        ),
        t(
          "Карточка товара, строка поиска или поле сканирования штрихкода",
          "Товар карточкасы, издөө сабы же штрихкод сканерлөө талаасы",
          "Product card, search field, or barcode scan input",
        ),
        t(
          "Товар появится в «Текущем чеке» справа с количеством 1 и рассчитанной суммой.",
          "Товар оң жактагы «Учурдагы чекте» 1 саны жана эсептелген суммасы менен чыгат.",
          "The product appears in Current receipt on the right with quantity 1 and a calculated line total.",
        ),
        { keepMedia: true },
      ),
      auditedStep(
        t(
          "Панель «Текущий чек» справа; на телефоне — вкладка «Документ»",
          "Оң жактагы «Учурдагы чек» панели; телефондо — «Документ» өтмөгү",
          "Current receipt panel on the right; on mobile, the Document tab",
        ),
        t(
          "Кнопки −/+, поле количества, цена строки и итог «К оплате»",
          "−/+ баскычтары, сан талаасы, сап баасы жана «Төлөөгө» жыйынтыгы",
          "−/+ quantity controls, line price, and Amount due",
        ),
        t(
          "Количество, сумма строки и общий итог соответствуют товарам, которые получает покупатель.",
          "Саны, сап суммасы жана жалпы жыйынтык кардар алган товарларга туура келет.",
          "Quantity, line totals, and Amount due match the goods the customer is taking.",
        ),
      ),
      auditedStep(
        t(
          "Раздел «Оплата» внизу текущего чека; на телефоне — вкладка «Оплата»",
          "Учурдагы чектин төмөнүндөгү «Төлөм» бөлүмү; телефондо — «Төлөм» өтмөгү",
          "Payments section at the bottom of Current receipt; on mobile, the Payment tab",
        ),
        t(
          "Список «Способ оплаты» и поле суммы; для второго способа — «Добавить оплату»",
          "«Төлөм ыкмасы» тизмеси жана сумма талаасы; экинчи ыкма үчүн — «Төлөм кошуу»",
          "Payment method selector and amount field; Add payment for another method",
        ),
        t(
          "«Итого оплат» совпадает с «К оплате»; иначе завершение продажи остаётся заблокированным.",
          "«Төлөмдөрдүн жыйынтыгы» «Төлөөгө» суммасына тең болот; болбосо сатууну бүтүрүү бөгөттөлөт.",
          "Payment total matches Amount due; otherwise completing the sale remains blocked.",
        ),
        {
          title: t("Укажите оплату", "Төлөмдү көрсөтүңүз", "Set payment"),
          body: t(
            "В разделе «Оплата» выберите способ. Для нескольких способов нажмите «Добавить оплату» и распределите точную сумму.",
            "«Төлөм» бөлүмүнөн ыкманы тандаңыз. Бир нече ыкма үчүн «Төлөм кошуу» басып, так сумманы бөлүштүрүңүз.",
            "In Payments, choose the method. For multiple methods, select Add payment and allocate the exact total.",
          ),
        },
      ),
      auditedStep(
        t(
          "Самый низ панели текущего чека",
          "Учурдагы чек панелинин эң төмөнкү бөлүгү",
          "Bottom of the Current receipt panel",
        ),
        t(
          "Зелёная кнопка «Завершить продажу»",
          "Жашыл «Сатууну бүтүрүү» баскычы",
          "Green Complete sale button",
        ),
        t(
          "Появится экран успешной продажи с номером чека; оплата запишется, а товар спишется один раз.",
          "Чектин номери менен ийгиликтүү сатуу экраны чыгат; төлөм жазылып, товар бир жолу азаят.",
          "A completed-sale screen shows the receipt number; payment is recorded and stock is reduced once.",
        ),
      ),
    ],
  },

  "pos/apply-discount": {
    roles: ["owner", "manager", "cashier", "stockkeeper"],
    summary: t(
      "Укажите скидку суммой на весь чек и проверьте итог до оплаты.",
      "Бүт чекке сумма түрүндө арзандатуу коюп, төлөмгө чейин жыйынтыкты текшериңиз.",
      "Apply an amount discount to the whole receipt and verify the total before payment.",
    ),
    steps: [
      auditedStep(
        t(
          "Касса → Продажа, каталог и «Текущий чек»",
          "Касса → Сатуу, каталог жана «Учурдагы чек»",
          "POS → Sell, catalog and Current receipt",
        ),
        t(
          "Карточка товара, поиск или сканер",
          "Товар карточкасы, издөө же сканер",
          "Product card, search, or scanner",
        ),
        t(
          "После добавления товара в сводке чека появятся «Подытог», «Скидка» и «К оплате».",
          "Товар кошулгандан кийин чек жыйынтыгында «Аралык жыйынтык», «Арзандатуу» жана «Төлөөгө» чыгат.",
          "After adding a product, the receipt summary shows Subtotal, Discount, and Amount due.",
        ),
        {
          body: t(
            "Добавьте все товары в текущий чек: скидка Bazaar применяется суммой ко всему чеку, а не к отдельной строке.",
            "Бардык товарларды учурдагы чекке кошуңуз: Bazaar арзандатууну өзүнчө сапка эмес, бүт чекке сумма менен колдонот.",
            "Add all products to Current receipt; Bazaar applies an amount discount to the receipt, not an individual line.",
          ),
        },
      ),
      auditedStep(
        t(
          "Сводка текущего чека, строка «Скидка» под «Подытогом»",
          "Учурдагы чектин жыйынтыгы, «Аралык жыйынтыктын» астындагы «Арзандатуу» сабы",
          "Current receipt summary, Discount row below Subtotal",
        ),
        t("Ссылка «+ Добавить скидку»", "«+ Арзандатуу кошуу» шилтемеси", "+ Add discount action"),
        t(
          "Откроется редактор «Скидка на чек» с режимом «Сумма» и полем ввода.",
          "«Сумма» режими жана киргизүү талаасы бар «Чекке арзандатуу» редактору ачылат.",
          "The Sale discount editor opens in Amount mode with an input field.",
        ),
        {
          body: t(
            "В строке «Скидка» нажмите «+ Добавить скидку».",
            "«Арзандатуу» сабындагы «+ Арзандатуу кошуу» аракетин басыңыз.",
            "In the Discount row, select + Add discount.",
          ),
        },
      ),
      auditedStep(
        t(
          "Редактор «Скидка на чек» внутри сводки",
          "Жыйынтыктын ичиндеги «Чекке арзандатуу» редактору",
          "Sale discount editor inside the receipt summary",
        ),
        t(
          "Поле суммы и кнопка «Применить скидку»",
          "Сумма талаасы жана «Арзандатууну колдонуу» баскычы",
          "Amount field and Apply discount button",
        ),
        t(
          "Редактор закроется после применения, а строка «Скидка» покажет сохранённую сумму.",
          "Колдонгондон кийин редактор жабылып, «Арзандатуу» сабы сакталган сумманы көрсөтөт.",
          "After applying, the editor closes and the Discount row shows the saved amount.",
        ),
        {
          body: t(
            "Введите сумму меньше подытога и нажмите «Применить скидку»; процентный режим в текущем POS не используется.",
            "Аралык жыйынтыктан аз сумманы киргизип, «Арзандатууну колдонуу» баскычын басыңыз; учурдагы POS пайыз режимин колдонбойт.",
            "Enter an amount below the subtotal and select Apply discount; the current POS does not use percentage mode.",
          ),
        },
      ),
      auditedStep(
        t(
          "Сводка чека сразу над разделом «Оплата»",
          "«Төлөм» бөлүмүнүн үстүндөгү чек жыйынтыгы",
          "Receipt summary immediately above Payments",
        ),
        t(
          "Значения «Подытог», «Скидка» и «К оплате»",
          "«Аралык жыйынтык», «Арзандатуу» жана «Төлөөгө» маанилери",
          "Subtotal, Discount, and Amount due values",
        ),
        t(
          "«К оплате» равно подытогу минус скидка; платежи вводятся уже на эту уменьшенную сумму.",
          "«Төлөөгө» аралык жыйынтыктан арзандатууну алып салганга тең; төлөмдөр ушул азайтылган суммага киргизилет.",
          "Amount due equals subtotal minus discount and payments use that reduced amount.",
        ),
      ),
    ],
  },

  "pos/split-payment": {
    roles: ["owner", "manager", "cashier", "stockkeeper"],
    steps: [
      auditedStep(
        t(
          "Касса → Продажа, нижняя часть «Текущего чека»",
          "Касса → Сатуу, «Учурдагы чектин» төмөнкү бөлүгү",
          "POS → Sell, lower part of Current receipt",
        ),
        t(
          "Раздел «Оплата» под итогом «К оплате»",
          "«Төлөөгө» жыйынтыгынын астындагы «Төлөм» бөлүмү",
          "Payments section below Amount due",
        ),
        t(
          "Первая строка оплаты автоматически показывает всю сумму чека.",
          "Биринчи төлөм сабы автоматтык түрдө чектин толук суммасын көрсөтөт.",
          "The first payment row initially shows the full receipt amount.",
        ),
        {
          body: t(
            "Добавьте товары и проверьте «К оплате», затем найдите раздел «Оплата» внизу текущего чека.",
            "Товарларды кошуп, «Төлөөгө» суммасын текшериңиз, андан кийин учурдагы чектин төмөнүнөн «Төлөм» бөлүмүн табыңыз.",
            "Add products and verify Amount due, then find Payments at the bottom of Current receipt.",
          ),
        },
      ),
      auditedStep(
        t("Раздел «Оплата»", "«Төлөм» бөлүмү", "Payments section"),
        t(
          "Список способа в первой строке и кнопка «Добавить оплату»",
          "Биринчи саптагы ыкма тизмеси жана «Төлөм кошуу» баскычы",
          "Method selector on the first row and Add payment button",
        ),
        t(
          "Появится вторая строка оплаты; суммы обеих строк станут редактируемыми.",
          "Экинчи төлөм сабы чыгат; эки саптын суммалары тең өзгөртүлө турган болот.",
          "A second payment row appears and both payment amounts become editable.",
        ),
        {
          title: t("Добавьте второй способ", "Экинчи ыкманы кошуңуз", "Add a second method"),
          body: t(
            "Выберите способ первой оплаты и нажмите «Добавить оплату» — отдельного переключателя «Разделить» нет.",
            "Биринчи төлөм ыкмасын тандап, «Төлөм кошуу» баскычын басыңыз — өзүнчө «Бөлүү» которгучу жок.",
            "Choose the first method and select Add payment; there is no separate Split toggle.",
          ),
        },
      ),
      auditedStep(
        t(
          "Две строки внутри раздела «Оплата»",
          "«Төлөм» бөлүмүндөгү эки сап",
          "Two rows inside Payments",
        ),
        t(
          "Списки способов и поля «Сумма оплаты»",
          "Ыкма тизмелери жана «Төлөм суммасы» талаалары",
          "Payment method selectors and Payment amount fields",
        ),
        t(
          "«Итого оплат» точно совпадёт с «К оплате»; при расхождении Bazaar покажет ошибку и не завершит чек.",
          "«Төлөмдөрдүн жыйынтыгы» «Төлөөгө» суммасына так тең болот; айырма болсо Bazaar ката көрсөтүп, чекти бүтүрбөйт.",
          "Payment total exactly matches Amount due; a mismatch shows an error and blocks completion.",
        ),
        {
          body: t(
            "Выберите разные способы и распределите суммы так, чтобы «Итого оплат» точно совпало с «К оплате».",
            "Ар башка ыкмаларды тандап, «Төлөмдөрдүн жыйынтыгы» «Төлөөгө» суммасына так тең болгондой бөлүштүрүңүз.",
            "Choose the methods and allocate amounts so Payment total exactly matches Amount due.",
          ),
        },
      ),
      auditedStep(
        t(
          "Низ текущего чека под строками оплаты",
          "Төлөм саптарынын астындагы учурдагы чектин төмөнү",
          "Bottom of Current receipt below the payment rows",
        ),
        t("Кнопка «Завершить продажу»", "«Сатууну бүтүрүү» баскычы", "Complete sale button"),
        t(
          "Успешный экран покажет один номер чека; в истории этого чека будут обе оплаты.",
          "Ийгиликтүү экран бир чек номерин көрсөтөт; бул чектин тарыхында эки төлөм тең болот.",
          "The success screen shows one receipt number and that receipt history contains both payments.",
        ),
      ),
    ],
  },

  "pos/hold-receipt": {
    roles: ["owner", "manager", "cashier", "stockkeeper"],
    steps: [
      auditedStep(
        t(
          "Касса → Продажа, каталог и текущий чек",
          "Касса → Сатуу, каталог жана учурдагы чек",
          "POS → Sell, catalog and Current receipt",
        ),
        t(
          "Каталог, поиск или сканер; затем количество в «Текущем чеке»",
          "Каталог, издөө же сканер; андан кийин «Учурдагы чектеги» сан",
          "Catalog, search, or scanner, then quantity in Current receipt",
        ),
        t(
          "Все нужные позиции и их количества видны в текущем чеке; оплата ещё не проведена.",
          "Керектүү бардык позициялар жана сандары учурдагы чекте көрүнөт; төлөм али өткөрүлгөн эмес.",
          "All required items and quantities are visible in Current receipt and no payment has been posted.",
        ),
      ),
      auditedStep(
        t(
          "Низ «Текущего чека», над зелёной кнопкой завершения",
          "«Учурдагы чектин» төмөнү, жашыл бүтүрүү баскычынын үстү",
          "Bottom of Current receipt, above the green completion button",
        ),
        t("Кнопка «Отложить чек»", "«Чекти калтыруу» баскычы", "Hold receipt button"),
        t(
          "Появится сообщение с номером отложенного чека; текущая корзина очистится для следующего покупателя.",
          "Калтырылган чектин номери менен билдирүү чыгат; учурдагы себет кийинки кардар үчүн тазаланат.",
          "A confirmation names the held receipt and the current cart clears for the next customer.",
        ),
        {
          body: t(
            "Нажмите «Отложить чек». Текущий POS не запрашивает отдельную заметку при откладывании.",
            "«Чекти калтыруу» баскычын басыңыз. Учурдагы POS калтырууда өзүнчө эскертүү сурабайт.",
            "Select Hold receipt. The current POS does not ask for a separate hold note.",
          ),
        },
      ),
      auditedStep(
        t(
          "Сообщение после откладывания и пустой «Текущий чек»",
          "Калтыргандан кийинки билдирүү жана бош «Учурдагы чек»",
          "Post-hold confirmation and empty Current receipt",
        ),
        t(
          "«Журнал чеков» → фильтр «Отложенные» для дополнительной проверки",
          "«Чектер журналы» → кошумча текшерүү үчүн «Калтырылган» фильтри",
          "Receipt journal → Held filter for an optional verification",
        ),
        t(
          "Чек отмечен «Отложен», а остаток товара не изменился до его завершения.",
          "Чек «Калтырылган» деп белгиленет, товар калдыгы чек бүткөнгө чейин өзгөрбөйт.",
          "The receipt is marked Held and stock remains unchanged until it is completed.",
        ),
        {
          body: t(
            "Убедитесь, что появился номер отложенного чека и новый текущий чек пуст. Товар со склада ещё не списан.",
            "Калтырылган чектин номери чыкканын жана жаңы учурдагы чек бош экенин текшериңиз. Товар кампадан али азайган жок.",
            "Verify that a held receipt number appears and the new current receipt is empty; stock has not been reduced yet.",
          ),
        },
      ),
    ],
  },

  "pos/resume-receipt": {
    roles: ["owner", "manager", "cashier", "stockkeeper"],
    appRoute: "/pos/sell",
    steps: [
      auditedStep(
        t(
          "Касса → Продажа, верхняя панель рядом с магазином и кассой",
          "Касса → Сатуу, дүкөн жана кассанын жанындагы жогорку панель",
          "POS → Sell, top bar beside the store and register",
        ),
        t("Кнопка «Журнал чеков»", "«Чектер журналы» баскычы", "Receipt journal button"),
        t(
          "Откроется журнал для текущего магазина и кассы с фильтрами чеков.",
          "Учурдагы дүкөн жана касса үчүн чек фильтрлери бар журнал ачылат.",
          "The receipt journal opens for the current store and register with receipt filters.",
        ),
        { keepMedia: true },
      ),
      auditedStep(
        t(
          "Панель фильтров «Журнала чеков»",
          "«Чектер журналынын» фильтр панели",
          "Receipt journal filter bar",
        ),
        t(
          "Фильтр «Отложенные» → «Только отложенные» и поиск по номеру или покупателю",
          "«Калтырылган» фильтри → «Калтырылгандар гана» жана номер же кардар боюнча издөө",
          "Held filter → Held only and receipt-number or customer search",
        ),
        t(
          "Список покажет нужный чек со статусом «Отложен», суммой, временем и кассиром.",
          "Тизме керектүү чекти «Калтырылган» статусу, суммасы, убактысы жана кассири менен көрсөтөт.",
          "The list shows the required Held receipt with its total, time, and cashier.",
        ),
        {
          body: t(
            "Выберите «Только отложенные» и найдите чек по номеру, времени, кассиру или сумме.",
            "«Калтырылгандар гана» тандап, чекти номер, убакыт, кассир же сумма боюнча табыңыз.",
            "Choose Held only and find the receipt by number, time, cashier, or total.",
          ),
        },
      ),
      auditedStep(
        t(
          "Строка найденного отложенного чека",
          "Табылган калтырылган чектин сабы",
          "Row for the matching held receipt",
        ),
        t(
          "Кнопка «Редактировать» на компьютере или «Продолжить» на телефоне",
          "Компьютердеги «Түзөтүү» же телефондогу «Улантуу» баскычы",
          "Edit on desktop or Resume on mobile",
        ),
        t(
          "Журнал закроется, появится сообщение о возврате чека, а его товары загрузятся в текущую корзину.",
          "Журнал жабылып, чек кайтарылганы тууралуу билдирүү чыгат жана товарлары учурдагы себетке жүктөлөт.",
          "The journal closes, a resumed-receipt confirmation appears, and its items load into the current cart.",
        ),
        {
          body: t(
            "Нажмите «Редактировать» на компьютере или «Продолжить» на телефоне; товары вернутся в текущий чек.",
            "Компьютерде «Түзөтүү» же телефондо «Улантуу» баскычын басыңыз; товарлар учурдагы чекке кайтып келет.",
            "Select Edit on desktop or Resume on mobile; the items return to Current receipt.",
          ),
        },
      ),
      auditedStep(
        t(
          "Раздел «Оплата» восстановленного текущего чека",
          "Калыбына келген учурдагы чектин «Төлөм» бөлүмү",
          "Payments section of the restored Current receipt",
        ),
        t(
          "Способ и сумма оплаты, затем «Завершить продажу»",
          "Төлөм ыкмасы жана суммасы, андан кийин «Сатууну бүтүрүү»",
          "Payment method and amount, then Complete sale",
        ),
        t(
          "Появится один успешный чек; отложенная запись исчезнет из фильтра, а остаток спишется один раз.",
          "Бир ийгиликтүү чек чыгат; калтырылган жазуу фильтрден жоголуп, калдык бир жолу азаят.",
          "One completed receipt appears, the held entry leaves the filter, and stock is reduced once.",
        ),
      ),
    ],
  },

  "pos/return-sale": {
    roles: ["owner", "manager", "cashier", "stockkeeper"],
    appRoute: "/pos/history",
    steps: [
      auditedStep(
        t(
          "Касса → История, карточка выбора кассы и поиска",
          "Касса → Тарых, кассаны тандоо жана издөө карточкасы",
          "POS → History, register and search card",
        ),
        t(
          "Список кассы и поле поиска по номеру чека; возврат требует открытую смену на этой кассе",
          "Касса тизмеси жана чек номери боюнча издөө; кайтаруу үчүн бул кассада ачык смена керек",
          "Register selector and receipt-number search; a return requires an open shift on that register",
        ),
        t(
          "Исходная завершённая продажа появится в списке с доступной кнопкой «Возврат».",
          "Баштапкы бүткөн сатуу тизмеде жеткиликтүү «Кайтаруу» баскычы менен чыгат.",
          "The original completed sale appears with an enabled Return button.",
        ),
      ),
      auditedStep(
        t(
          "Строка исходной продажи в карточке «Продажи»",
          "«Сатуулар» карточкасындагы баштапкы сатуу сабы",
          "Original sale row in the Sales card",
        ),
        t("Кнопка «Возврат»", "«Кайтаруу» баскычы", "Return button"),
        t(
          "Откроется окно возврата с номером исходного чека, возвратными позициями и доступным количеством.",
          "Баштапкы чектин номери, кайтарыла турган позициялар жана жеткиликтүү саны бар кайтаруу терезеси ачылат.",
          "A return dialog opens with the original receipt number, returnable lines, and available quantities.",
        ),
      ),
      auditedStep(
        t(
          "Таблица товаров в окне возврата",
          "Кайтаруу терезесиндеги товарлар таблицасы",
          "Item table in the return dialog",
        ),
        t(
          "Поля количества напротив возвращённых товаров",
          "Кайтарылган товарлардын жанындагы сан талаалары",
          "Quantity fields beside the returned items",
        ),
        t(
          "Итог возврата пересчитается только по выбранным количествам и не превысит доступное к возврату.",
          "Кайтаруу жыйынтыгы тандалган сандар боюнча гана кайра эсептелип, жеткиликтүү санынан ашпайт.",
          "Return total recalculates only from selected quantities and cannot exceed the returnable amount.",
        ),
      ),
      auditedStep(
        t(
          "Нижняя часть окна возврата",
          "Кайтаруу терезесинин төмөнкү бөлүгү",
          "Bottom of the return dialog",
        ),
        t(
          "Список «Способ возврата» и кнопка «Завершить возврат»",
          "«Кайтаруу ыкмасы» тизмеси жана «Кайтарууну бүтүрүү» баскычы",
          "Refund method selector and Complete return button",
        ),
        t(
          "Появится сообщение об успешном возврате; рассчитанная сумма вернётся выбранным способом, а товар восстановится на складе.",
          "Ийгиликтүү кайтаруу билдирүүсү чыгат; эсептелген сумма тандалган ыкма менен кайтып, товар кампага калыбына келет.",
          "A return-success message appears; the calculated refund uses the selected method and stock is restored.",
        ),
        {
          body: t(
            "Выберите способ возврата. Сумма рассчитывается по количествам автоматически; проверьте итог и нажмите «Завершить возврат».",
            "Кайтаруу ыкмасын тандаңыз. Сумма сандар боюнча автоматтык эсептелет; жыйынтыкты текшерип, «Кайтарууну бүтүрүү» баскычын басыңыз.",
            "Choose the refund method. The amount is calculated from quantities; verify the total and select Complete return.",
          ),
        },
      ),
    ],
  },

  "pos/close-shift": {
    roles: ["owner", "manager", "cashier", "stockkeeper"],
    steps: [
      auditedStep(
        t(
          "Касса → Смены, блоки незавершённых документов текущей смены",
          "Касса → Сменалар, учурдагы сменанын бүтпөгөн документ блоктору",
          "POS → Shifts, unresolved-document blocks for the current shift",
        ),
        t(
          "«Открыть чек»/«Забрать чек» для активных и отложенных чеков; «Отменить черновик» для возвратов",
          "Активдүү жана калтырылган чектер үчүн «Чекти ачуу»/«Чекти алуу»; кайтаруулар үчүн «Черновикти жокко чыгаруу»",
          "Open receipt/Take receipt for active and held receipts; Cancel draft for returns",
        ),
        t(
          "Счётчики активных, отложенных и возвратных черновиков станут нулевыми; только тогда закрытие разблокируется.",
          "Активдүү, калтырылган жана кайтаруу черновиктеринин эсептегичтери нөл болот; ошондо гана жабуу ачылат.",
          "Active, held, and return-draft counts reach zero; only then is closing unblocked.",
        ),
        {
          body: t(
            "Завершите или отмените все активные и отложенные чеки, а также черновики возврата: отложенный чек тоже блокирует закрытие.",
            "Бардык активдүү жана калтырылган чектерди, ошондой эле кайтаруу черновиктерин бүтүрүңүз же жокко чыгарыңыз: калтырылган чек да жабууга бөгөт коёт.",
            "Complete or cancel every active and held receipt and every return draft; held receipts also block closing.",
          ),
        },
      ),
      auditedStep(
        t(
          "Касса → Смены, верхний список касс",
          "Касса → Сменалар, жогорку кассалар тизмеси",
          "POS → Shifts, register selector at the top",
        ),
        t("Список «Касса»", "«Касса» тизмеси", "Register selector"),
        t(
          "Карточка «Текущая смена» покажет нужную открытую смену, кассира и сводку продаж.",
          "«Учурдагы смена» карточкасы керектүү ачык сменаны, кассирди жана сатуу жыйынтыгын көрсөтөт.",
          "Current shift shows the required open shift, cashier, and sales summary.",
        ),
      ),
      auditedStep(
        t(
          "Карточка закрытия под сводкой кассового ящика",
          "Касса суурмасынын жыйынтыгынын астындагы жабуу карточкасы",
          "Closing card below the cash-drawer summary",
        ),
        t(
          "Поле «Подсчитанная наличность»",
          "«Саналган накталай акча» талаасы",
          "Counted cash field",
        ),
        t(
          "Bazaar сразу пересчитает «Расхождение» относительно ожидаемой наличности.",
          "Bazaar күтүлгөн накталай акчага салыштырмалуу «Айырманы» дароо кайра эсептейт.",
          "Bazaar immediately recalculates Difference against expected cash.",
        ),
      ),
      auditedStep(
        t(
          "Тот же блок закрытия под полем наличности",
          "Накталай акча талаасынын астындагы ошол эле жабуу блогу",
          "Same closing block below Counted cash",
        ),
        t(
          "Значение «Расхождение» и обязательное поле «Примечание к закрытию» при ненулевой разнице",
          "«Айырма» мааниси жана айырма нөл эмес болсо милдеттүү «Жабуу эскертүүсү» талаасы",
          "Difference value and required Closing note when the variance is non-zero",
        ),
        t(
          "«Расхождение» показывает баланс при нуле; для недостачи или излишка введено объяснение.",
          "«Айырма» нөлдө тең салмакты көрсөтөт; жетишпестик же ашыкча үчүн түшүндүрмө киргизилет.",
          "Difference shows Balanced at zero; a shortage or surplus has an explanatory note.",
        ),
      ),
      auditedStep(
        t(
          "Нижняя часть блока закрытия смены",
          "Сменаны жабуу блогунун төмөнкү бөлүгү",
          "Footer of the shift-closing block",
        ),
        t(
          "Переключатель «Подтвердить закрытие», затем кнопка «Закрыть смену»",
          "«Жабууну ырастоо» которгучу, андан кийин «Сменаны жабуу» баскычы",
          "Confirm close switch, then Close shift button",
        ),
        t(
          "Появится сообщение об успешном закрытии; текущая смена исчезнет, а её итог и расхождение появятся в истории.",
          "Ийгиликтүү жабуу билдирүүсү чыгат; учурдагы смена жоголуп, жыйынтыгы жана айырмасы тарыхта чыгат.",
          "A close-success message appears; Current shift clears and its totals and variance appear in History.",
        ),
        {
          body: t(
            "Включите «Подтвердить закрытие» и нажмите «Закрыть смену» один раз; проверьте, что смена появилась в истории.",
            "«Жабууну ырастоо» которгучун күйгүзүп, «Сменаны жабуу» баскычын бир жолу басыңыз; смена тарыхта чыкканын текшериңиз.",
            "Turn on Confirm close and select Close shift once; verify that the shift appears in History.",
          ),
        },
      ),
    ],
  },

  "settings/add-employee": {
    roles: ["owner"],
    appRoute: "/settings/users",
    steps: [
      auditedStep(
        t(
          "Боковое меню → Настройки → Пользователи",
          "Каптал меню → Жөндөөлөр → Колдонуучулар",
          "Side navigation → Settings → Users",
        ),
        t("Пункт «Пользователи»", "«Колдонуучулар» пункту", "Users navigation item"),
        t(
          "Откроется страница пользователей; карточка «Пригласить сотрудника» видна только администратору.",
          "Колдонуучулар барагы ачылат; «Кызматкер чакыруу» карточкасы администраторго гана көрүнөт.",
          "The Users page opens; Invite employee is available only to an administrator.",
        ),
      ),
      auditedStep(
        t(
          "Карточка «Пригласить сотрудника» под списком пользователей",
          "Колдонуучулар тизмесинин астындагы «Кызматкер чакыруу» карточкасы",
          "Invite employee card below the user list",
        ),
        t("Поле «Рабочий email»", "«Жумуш email'и» талаасы", "Work email field"),
        t(
          "Поле примет корректный адрес; именно на него будет отправлена одноразовая ссылка регистрации.",
          "Талаа туура даректи кабыл алат; бир жолку каттоо шилтемеси дал ушул дарекке жөнөтүлөт.",
          "The field accepts a valid address; the one-time registration link will be sent there.",
        ),
        {
          title: t("Введите рабочий email", "Жумуш email'ин киргизиңиз", "Enter the work email"),
          body: t(
            "В карточке «Пригласить сотрудника» введите рабочий email; отдельную кнопку открытия нажимать не нужно.",
            "«Кызматкер чакыруу» карточкасына жумуш email'ин киргизиңиз; өзүнчө ачуу баскычын басуунун кереги жок.",
            "Enter the work email directly in Invite employee; there is no separate dialog-opening button.",
          ),
        },
      ),
      auditedStep(
        t(
          "Та же карточка, под email",
          "Ошол эле карточка, email'дин астында",
          "Same card below the email field",
        ),
        t(
          "Список «Роль»: Администратор, Менеджер, Кассир или Сотрудник",
          "«Роль» тизмеси: Администратор, Менеджер, Кассир же Кызматкер",
          "Role selector: Administrator, Manager, Cashier, or Staff",
        ),
        t(
          "Под ролью появится соответствующий блок доступа к магазинам; администратор автоматически получает все магазины.",
          "Ролдун астында тиешелүү дүкөн жеткиликтүүлүгү чыгат; администратор бардык дүкөндөрдү автоматтык алат.",
          "The matching Store access section appears; Administrator automatically receives all stores.",
        ),
        {
          body: t(
            "Выберите минимальную рабочую роль: Администратор, Менеджер, Кассир или Сотрудник.",
            "Минималдуу керектүү ролду тандаңыз: Администратор, Менеджер, Кассир же Кызматкер.",
            "Choose the least-privileged working role: Administrator, Manager, Cashier, or Staff.",
          ),
        },
      ),
      auditedStep(
        t(
          "Блок «Доступ к магазинам» под ролью",
          "Ролдун астындагы «Дүкөндөргө жеткиликтүүлүк» блогу",
          "Store access section below Role",
        ),
        t(
          "Флажки магазинов для Менеджера, Кассира или Сотрудника",
          "Менеджер, Кассир же Кызматкер үчүн дүкөн белгилери",
          "Store checkboxes for Manager, Cashier, or Staff",
        ),
        t(
          "В блоке останутся отмечены только рабочие точки сотрудника; для Администратора показано «Все магазины».",
          "Блокто кызматкер иштеген жерлер гана белгиленет; Администратор үчүн «Бардык дүкөндөр» көрсөтүлөт.",
          "Only the employee's working locations remain selected; Administrator shows All stores.",
        ),
      ),
      auditedStep(
        t(
          "Низ карточки «Пригласить сотрудника»",
          "«Кызматкер чакыруу» карточкасынын төмөнү",
          "Bottom of the Invite employee card",
        ),
        t("Кнопка «Отправить приглашение»", "«Чакыруу жөнөтүү» баскычы", "Send invitation button"),
        t(
          "Появится сообщение о создании; приглашение будет «Ожидает» в списке, а при проблеме с email появится ссылка для копирования.",
          "Түзүлгөнү тууралуу билдирүү чыгат; чакыруу тизмеде «Күтүүдө» болот, email жөнөтүлбөсө көчүрүүчү шилтеме чыгат.",
          "A created confirmation appears; the invite is Pending in the list and a copyable link appears if email delivery fails.",
        ),
      ),
    ],
  },

  "reports/export-reports": {
    roles: ["owner", "manager"],
    appRoute: "/reports/exports",
    summary: t(
      "Создайте асинхронную выгрузку для магазина, дождитесь готовности и скачайте файл из журнала.",
      "Дүкөн үчүн асинхрондук экспорт түзүп, даяр болушун күтүп, файлды журналдан жүктөңүз.",
      "Create an asynchronous store export, wait until it is ready, and download it from the job journal.",
    ),
    success: t(
      "Задание завершено со статусом «Готово», а файл скачан из журнала выгрузок.",
      "Тапшырма «Даяр» статусу менен бүтүп, файл экспорт журналынан жүктөлдү.",
      "The job is Done and its file is downloaded from the export journal.",
    ),
    steps: [
      auditedStep(
        t(
          "Отчёты → Выгрузки → карточка «Запрос выгрузки»",
          "Отчёттор → Экспорттор → «Экспорт сурамы» карточкасы",
          "Reports → Exports → Export request card",
        ),
        t(
          "Список «Магазин», кнопки категории и карточка типа выгрузки",
          "«Дүкөн» тизмеси, категория баскычтары жана экспорт түрүнүн карточкасы",
          "Store selector, category buttons, and an export-type card",
        ),
        t(
          "Выбранный тип подсветится, а его описание и рекомендуемый формат появятся в запросе.",
          "Тандалган түр белгиленип, анын сүрөттөмөсү жана сунушталган форматы сурамда чыгат.",
          "The selected type is highlighted and its description and recommended format appear in the request.",
        ),
        {
          title: t(
            "Выберите магазин и выгрузку",
            "Дүкөндү жана экспортту тандаңыз",
            "Choose the store and export",
          ),
          body: t(
            "Откройте «Отчёты → Выгрузки», выберите магазин, затем категорию и точный тип файла — например, реестр движений или продажи по товарам.",
            "«Отчёттор → Экспорттор» бөлүмүн ачып, дүкөндү, андан кийин категорияны жана так файл түрүн — мисалы кыймылдар реестрин же товар боюнча сатууну — тандаңыз.",
            "Open Reports → Exports, choose the store, then select the category and exact export type, such as Inventory movements ledger or Sales by item.",
          ),
        },
      ),
      auditedStep(
        t(
          "Верхняя сетка карточки «Запрос выгрузки»",
          "«Экспорт сурамы» карточкасынын жогорку тору",
          "Top form grid in Export request",
        ),
        t(
          "Список «Формат», даты «Начало периода»/«Конец периода» или кнопка периода",
          "«Формат» тизмеси, «Мезгил башы»/«Мезгил аягы» даталары же мезгил баскычы",
          "Format selector, Period start/Period end, or a period preset",
        ),
        t(
          "В карточке запроса отображаются выбранный CSV/XLSX и корректный диапазон дат; начало не позже конца.",
          "Сурам карточкасында тандалган CSV/XLSX жана туура дата аралыгы көрүнөт; башы аягынан кеч эмес.",
          "The request shows the selected CSV/XLSX format and a valid date range whose start is not after its end.",
        ),
        {
          title: t(
            "Задайте формат и период",
            "Форматты жана мезгилди коюңуз",
            "Set format and period",
          ),
          body: t(
            "Выберите CSV или XLSX и задайте начало и конец периода либо используйте готовую кнопку «Сегодня», «7 дней» или другой период.",
            "CSV же XLSX тандап, мезгилдин башы менен аягын коюңуз же «Бүгүн», «7 күн» сыяктуу даяр баскычты колдонуңуз.",
            "Choose CSV or XLSX and set Period start and Period end, or use a preset such as Today or Last 7 days.",
          ),
        },
      ),
      auditedStep(
        t(
          "Низ карточки «Запрос выгрузки»",
          "«Экспорт сурамы» карточкасынын төмөнү",
          "Bottom of the Export request card",
        ),
        t("Кнопка «Сформировать»", "«Түзүү» баскычы", "Generate button"),
        t(
          "Появится сообщение о создании, а новая строка в «Журнале выгрузок» получит статус «В очереди» или «Выполняется».",
          "Түзүлгөнү тууралуу билдирүү чыгып, «Экспорт журналындагы» жаңы сап «Кезекте» же «Аткарылууда» статусун алат.",
          "A created confirmation appears and a new Export jobs row is Queued or Running.",
        ),
        {
          title: t("Запустите формирование", "Түзүүнү баштаңыз", "Generate the export"),
          body: t(
            "Нажмите «Сформировать» один раз. Bazaar создаст фоновое задание; файл не скачивается мгновенно.",
            "«Түзүү» баскычын бир жолу басыңыз. Bazaar фондук тапшырма түзөт; файл дароо жүктөлбөйт.",
            "Select Generate once. Bazaar creates a background job; the file does not download immediately.",
          ),
        },
      ),
      auditedStep(
        t(
          "Карточка «Журнал выгрузок» под запросом",
          "Сурамдын астындагы «Экспорт журналы» карточкасы",
          "Export jobs card below the request",
        ),
        t(
          "Кнопка обновления, статус «Готово» и действие скачивания в строке",
          "Жаңыртуу баскычы, «Даяр» статусу жана саптагы жүктөө аракети",
          "Refresh button, Done status, and the row Download action",
        ),
        t(
          "Браузер скачает файл только из строки со статусом «Готово»; имя и размер остаются видны в журнале.",
          "Браузер файлды «Даяр» статусундагы саптан гана жүктөйт; аталышы жана көлөмү журналда көрүнүп калат.",
          "The browser downloads only from a Done row and the file name and size remain visible in the journal.",
        ),
        {
          title: t("Дождитесь и скачайте", "Күтүп, жүктөп алыңыз", "Wait and download"),
          body: t(
            "Обновляйте «Журнал выгрузок», пока статус не станет «Готово», затем используйте действие «Скачать» в этой строке. При статусе «Ошибка» доступен повтор.",
            "Статус «Даяр» болгонго чейин «Экспорт журналын» жаңыртып, ошол саптагы «Жүктөө» аракетин колдонуңуз. «Ката» статусунда кайталоо жеткиликтүү.",
            "Refresh Export jobs until status is Done, then use Download on that row. Failed jobs provide a Retry action.",
          ),
        },
      ),
    ],
  },
};

export const consequentialGuideIds = Object.freeze(Object.keys(consequentialGuideAudits));

export const applyConsequentialGuidance = (guide: HelpGuide): HelpGuide => {
  const guideId = `${guide.category}/${guide.slug}`;
  const audit = consequentialGuideAudits[guideId];
  if (!audit) return guide;

  if (audit.steps.length !== guide.steps.length) {
    throw new Error(
      `Consequential Guide audit for ${guideId} has ${audit.steps.length} steps; catalog has ${guide.steps.length}.`,
    );
  }

  return {
    ...guide,
    ...(audit.roles ? { roles: audit.roles } : {}),
    ...(audit.appRoute ? { appRoute: audit.appRoute } : {}),
    ...(audit.summary ? { summary: audit.summary } : {}),
    ...(audit.success ? { success: audit.success } : {}),
    steps: guide.steps.map((originalStep: HelpStep, index) => {
      const { title, body, keepMedia, location, control, result } = audit.steps[index]!;
      return {
        ...originalStep,
        ...(title ? { title } : {}),
        ...(body ? { body } : {}),
        guidance: { location, control, result },
        ...(!keepMedia ? { media: undefined } : {}),
      };
    }),
  };
};
