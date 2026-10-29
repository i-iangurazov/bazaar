import { helpText as t } from "./ui";
import type { HelpGuide } from "./types";

export const priceBookGuides: HelpGuide[] = [
  {
    category: "products",
    slug: "shared-prices",
    roles: ["owner"],
    estimatedMinutes: 6,
    appRoute: "/settings/price-lists",
    title: t(
      "Общие и индивидуальные цены",
      "Жалпы жана жеке баалар",
      "Shared and individual prices",
    ),
    summary: t(
      "Один прайс для магазинов, безопасная массовая правка и сверка цен без переноса.",
      "Дүкөндөр үчүн бир баа тизмеси, коопсуз жапырт түзөтүү жана көчүрүүсүз салыштыруу.",
      "One list for stores, safe bulk editing and read-only price comparison.",
    ),
    keywords: t(
      "прайс цены розница опт магазины массовая правка откат сверка",
      "баа тизме чекене дүң дүкөн жапырт артка кайтаруу салыштыруу",
      "price list retail wholesale stores bulk rollback compare",
    ),
    aliases: t(
      "одинаковые цены во всех магазинах изменить цены на процент",
      "бардык дүкөндөрдө бирдей баалар бааларды пайызга өзгөртүү",
      "same prices across stores change prices by percent",
    ),
    steps: [
      {
        title: t("Создайте прайс", "Баа тизмесин түзүңүз", "Create a price list"),
        body: t(
          "В настройках откройте «Общие прайсы». Раздел доступен администратору и владельцу на тарифах с ценами магазинов. Все суммы здесь в KGS. Ассортимент, остатки и себестоимость управляются отдельно.",
          "Жөндөөлөрдөн «Жалпы баа тизмелери» бөлүмүн ачыңыз. Бөлүм дүкөн бааларын камтыган тарифтерде администраторго жана ээсине жеткиликтүү. Суммалар KGS менен. Ассортимент, калдыктар жана өздүк нарк өзүнчө башкарылат.",
          "Open Shared price lists in Settings. Administrators and owners with the store-pricing plan capability can use it. Amounts are in KGS. Assortment, stock and cost are managed separately.",
        ),
      },
      {
        title: t("Подготовьте цены", "Бааларды даярдаңыз", "Prepare prices"),
        body: t(
          "Добавьте розничную и необязательную оптовую цену для товара или варианта. Можно подготовить прайс из магазина: по умолчанию уже заполненные позиции сохраняются. Для массового изменения выберите товары либо явно подтвердите весь существующий прайс. Ноль — цена; пустое значение — отсутствие цены.",
          "Товар же вариант үчүн чекене жана милдеттүү эмес дүң бааны кошуңуз. Тизмени дүкөндөн даярдоого болот: мурда толтурулган позициялар демейки боюнча сакталат. Жапырт өзгөртүү үчүн товарларды же бүт тизмени тандаңыз. Нөл — баа; бош маани — баанын жоктугу.",
          "Stage retail and optional wholesale prices for products or variants. Prepare from a store while preserving existing entries by default. Bulk editing targets selected products or the explicitly reviewed whole list. Zero is a price; blank means absent.",
        ),
      },
      {
        title: t(
          "Подключите магазины явно",
          "Дүкөндөрдү өзүнчө туташтырыңыз",
          "Connect stores explicitly",
        ),
        body: t(
          "Выберите магазины и оставьте включённым сохранение индивидуальных цен, если нет решения заменить их общими. Цены следуют прайсу только после подключения. Новые товары добавляйте в прайс отдельно; полный ассортимент сам цены не копирует.",
          "Дүкөндөрдү тандаңыз. Жеке бааларды жалпыга алмаштыруу чечими жок болсо, аларды сактоону өчүрбөңүз. Баалар туташтыргандан кийин гана тизмеге ылайык өзгөрөт. Жаңы товарларды тизмеге өзүнчө кошуңуз; толук ассортимент бааларды көчүрбөйт.",
          "Choose stores and preserve their individual prices unless replacing them was explicitly decided. Stores follow the list only after connection. Add future products to the price list explicitly; a full assortment does not copy prices.",
        ),
      },
      {
        title: t("Проверьте и примените", "Текшерип колдонуңуз", "Review and apply"),
        body: t(
          "Проверьте название прайса, магазины, количество и примеры цен до/после. Предпросмотр живёт 10 минут; при изменении данных его нужно получить заново. Операция применяется целиком, повтор после потерянного ответа использует тот же ключ. Открытые и проведённые документы не пересчитываются. Последнюю операцию можно откатить из журнала, если после неё цены и область не менялись.",
          "Тизменин аталышын, дүкөндөрдү, санын жана мурунку/жаңы бааларды текшериңиз. Алдын ала көрүү 10 мүнөт жарактуу; маалымат өзгөрсө, кайра текшериңиз. Аракет толугу менен колдонулат; жооп жоголсо, ошол эле ачкыч менен кайталанат. Ачык жана жүргүзүлгөн документтер кайра эсептелбейт. Баалар жана чөйрө өзгөрбөсө, акыркы аракетти журналдан артка кайтарууга болот.",
          "Review the list, stores, counts and before/after samples. A preview expires in 10 minutes and must be refreshed if data changes. Application is atomic; retrying a lost response uses the same key. Open and posted documents are not repriced. The latest operation can be rolled back from history if prices and scope have not changed since.",
        ),
      },
      {
        title: t(
          "Настройте исключения и сверку",
          "Өзгөчө бааларды жана салыштырууну жөндөңүз",
          "Manage exceptions and comparison",
        ),
        body: t(
          "Изменение цен в карточке или таблице товара сохраняет индивидуальную цену только этого вида. В общем прайсе выберите магазин, чтобы проверить или вернуть наследование. Отключение магазина или удаление строки прайса сохраняет последние цены как индивидуальные. Вкладка сверки сравнивает магазины по ID товара и варианта, отдельно показывает пустые и нулевые цены и ничего не сохраняет.",
          "Товар карточкасында же таблицада бааны өзгөртүү ошол түрдөгү жеке бааны сактайт. Жалпы тизмеден дүкөндү тандап, мурастоону текшериңиз же калыбына келтириңиз. Дүкөндү ажыратуу же сапты алып салуу акыркы бааларды жеке катары сактайт. Салыштыруу товар жана вариант ID боюнча жүрөт, бош жана нөлдүк бааларды айырмалайт жана эч нерсе сактабайт.",
          "Editing a product price in its card or table makes that price kind individual. Select a store in the list to inspect or restore inheritance. Disconnecting a store or removing a list entry freezes current prices as individual. Comparison matches product and variant IDs, distinguishes missing from zero and never saves changes.",
        ),
      },
    ],
    success: t(
      "Магазины используют проверенный общий прайс с явными исключениями и журналом.",
      "Дүкөндөр текшерилген жалпы тизмени өзгөчө баалар жана журнал менен колдонушат.",
      "Stores use a reviewed shared price list with explicit exceptions and history.",
    ),
    relatedGuides: ["products/shared-catalog", "products/add-product", "pos/make-sale"],
  },
];
