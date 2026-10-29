import { helpText as t } from "./ui";
import type { HelpGuide } from "./types";

export const sharedCatalogGuides: HelpGuide[] = [
  {
    category: "products",
    slug: "shared-catalog",
    roles: ["owner", "manager"],
    estimatedMinutes: 6,
    appRoute: "/settings/store-groups",
    title: t(
      "Один товар в нескольких магазинах",
      "Бир товар бир нече дүкөндө",
      "One product across multiple stores",
    ),
    summary: t(
      "Подключение ассортимента, отдельные остатки, архив и перенос штрихкода без повторного создания товара.",
      "Товарды кайра түзбөстөн ассортиментти туташтыруу, өзүнчө калдыктар, архив жана штрихкодду көчүрүү.",
      "Connect assortment, keep stock separate, and handle archives and barcodes without recreating products.",
    ),
    keywords: t(
      "ассортимент склад магазин каталог дубли архив штрихкод перемещение",
      "ассортимент кампа дүкөн каталог көчүрмө архив штрихкод көчүрүү",
      "assortment warehouse store catalog duplicates archive barcode transfer",
    ),
    aliases: t(
      "товар не появился в магазине штрихкод занят товар из архива",
      "товар дүкөндө көрүнбөйт штрихкод колдонулууда архивдеги товар",
      "product missing in store barcode already used archived product",
    ),
    steps: [
      {
        title: t(
          "Сначала найдите существующую карточку",
          "Адегенде бар карточканы табыңыз",
          "Find the existing product first",
        ),
        body: t(
          "Проверьте товар по артикулу, штрихкоду и варианту. В списке товаров выберите магазин и действие «Добавить существующие товары». Подключается та же карточка организации, остатки других магазинов не копируются. Если источник ассортимента был явно отключён, измените его через редактор ассортимента.",
          "Товарды артикулу, штрихкоду жана варианты боюнча текшериңиз. Товарлар тизмесинен дүкөндү жана «Бар товарларды кошуу» аракетин тандаңыз. Уюмдун ошол эле карточкасы туташат, башка дүкөндөрдүн калдыктары көчүрүлбөйт. Ассортимент булагы өчүрүлгөн болсо, аны ассортимент редакторунан өзгөртүңүз.",
          "Check SKU, barcode and variant. Select the store in Products and use Add existing products. This connects the same organization product without copying other stores' stock. If an assortment source was explicitly disabled, change it in the assortment editor.",
        ),
      },
      {
        title: t(
          "Настройте постоянное подключение",
          "Туруктуу туташууну жөндөңүз",
          "Configure ongoing assortment access",
        ),
        body: t(
          "Администратор или владелец открывает «Ассортимент магазинов», выбирает получателя и добавляет проверенный источник. «Весь каталог» включает будущие товары источника; выбранный список остаётся фиксированным. Перед сохранением проверьте последствия и направление передачи. Подключение ассортимента не переносит магазинные цены и физические остатки.",
          "Администратор же ээси «Дүкөндөрдүн ассортименти» бөлүмүн ачып, алуучуну жана текшерилген булакты тандайт. «Бүт каталог» булактын келечектеги товарларын да камтыйт; тандалган тизме өзгөрбөйт. Сактоодон мурун таасирин жана багытын текшериңиз. Ассортиментти туташтыруу дүкөн бааларын жана калдыктарын көчүрбөйт.",
          "An administrator or owner opens Store assortment, selects the recipient and connects a verified source. Full catalog includes future source products; a selected list stays fixed. Review direction and impact before saving. Assortment access does not copy store prices or physical stock.",
        ),
      },
      {
        title: t(
          "Проверьте перемещение и остаток получателя",
          "Көчүрүүнү жана алуучунун калдыгын текшериңиз",
          "Check the transfer and recipient stock",
        ),
        body: t(
          "Откройте проведённое перемещение в журнале движений. У обычного получателя товар подключается при перемещении. При явно ограниченном ассортименте остаток может находиться в складском учёте, но товар ещё недоступен для продажи. Проверьте получателя и фильтр «Не в ассортименте» в запасах; при необходимости подключите источник. Повторно создавать карточку не нужно.",
          "Өткөрүлгөн көчүрүүнү кыймылдар журналынан ачыңыз. Кадимки алуучуда товар көчүрүлгөндө туташат. Ассортимент чектелсе, калдык кампа эсебинде болуп, товар сатууга жеткиликсиз болушу мүмкүн. Алуучуну жана запастардагы «Ассортиментте жок» чыпкасын текшериңиз; керек болсо булакты туташтырыңыз. Карточканы кайра түзүүнүн кереги жок.",
          "Open the posted transfer in the movement journal. A regular recipient gains access during transfer. With an explicitly restricted assortment, stock can exist in inventory while the product is unavailable for sale. Check the recipient and Not in assortment inventory filter, then connect the source if needed. Do not recreate the product.",
        ),
      },
      {
        title: t(
          "Используйте архив для прежнего товара",
          "Мурунку товар үчүн архивди колдонуңуз",
          "Use the archive for an existing product",
        ),
        body: t(
          "Найдите прежнюю карточку в архиве и восстановите её, если это тот же товар. Архивирование общей карточки влияет на доступность товара в магазинах; для изменения ассортимента одной точки используйте настройки этой точки. Проведённые документы и движения сохраняются.",
          "Эгер ошол эле товар болсо, мурунку карточканы архивден таап калыбына келтириңиз. Жалпы карточканы архивдөө дүкөндөрдөгү жеткиликтүүлүккө таасир этет; бир дүкөндүн ассортиментин өзгөртүү үчүн анын жөндөөлөрүн колдонуңуз. Өткөрүлгөн документтер жана кыймылдар сакталат.",
          "Restore the archived card if it represents the same product. Archiving a shared product affects its availability across stores; use store assortment settings to change availability at one location. Posted documents and movements remain intact.",
        ),
      },
      {
        title: t(
          "Переносите штрихкод только при необходимости",
          "Штрихкодду зарыл болгондо гана көчүрүңүз",
          "Transfer a barcode only when needed",
        ),
        body: t(
          "Если штрихкод действительно должен принадлежать другой карточке, проверьте найденный архивный товар и выберите «Переместить штрихкод», затем сохраните новую карточку. Действие доступно при соответствующих правах. Перенос штрихкода не объединяет товары, остатки или историю. Если сохранение не удалось, прежний штрихкод остаётся у источника.",
          "Штрихкод башка карточкага таандык болушу керек болсо, табылган архивдик товарды текшерип, «Штрихкодду көчүрүү» аракетин тандап, жаңы карточканы сактаңыз. Аракет тиешелүү укуктар менен жеткиликтүү. Штрихкодду көчүрүү товарларды, калдыктарды же тарыхты бириктирбейт. Сактоо ишке ашпаса, штрихкод мурунку товарда калат.",
          "If the barcode belongs on a different product, review the archived match, select Transfer barcode and save the target product. The action requires permission. It does not merge products, stock or history. A failed save leaves the barcode on the source product.",
        ),
      },
    ],
    success: t(
      "В магазинах используется одна карточка, физические остатки учитываются отдельно.",
      "Дүкөндөрдө бир карточка колдонулуп, калдыктар өзүнчө эсептелет.",
      "Stores use the same product identity while physical stock stays separate.",
    ),
    relatedGuides: ["products/add-product", "products/import-products", "inventory/transfer"],
  },
];
