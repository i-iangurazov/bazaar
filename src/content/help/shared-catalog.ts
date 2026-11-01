import { helpText as t } from "./ui";
import type { HelpGuide } from "./types";

export const sharedCatalogGuides: HelpGuide[] = [
  {
    category: "products",
    slug: "shared-catalog",
    roles: ["owner", "manager"],
    estimatedMinutes: 8,
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
        title: t("Используйте найденный товар вместо новой карточки", "Жаңы карточканын ордуна табылган товарды колдонуңуз", "Reuse a matching product"),
        body: t(
          "При создании, в том числе в быстрой форме, проверьте подсказки по названию и штрихкоду. У подходящей карточки нажмите «Использовать этот товар». Сравните название, единицу и вариант, выберите магазины и проверьте предпросмотр. Подключается существующий товар; введённые данные новой карточки на него не переносятся. Недоступный по правам товар подключает администратор.",
          "Түзүүдө, анын ичинде тез формада, аталыш жана штрихкод боюнча сунуштарды текшериңиз. Ылайыктуу карточкадан «Бул товарды колдонуу» баскычын басыңыз. Аталышын, өлчөмүн жана вариантын салыштырып, дүкөндөрдү тандап, алдын ала көрүүнү текшериңиз. Учурдагы товар туташат; жаңы карточкага киргизилген маалымат ага көчүрүлбөйт. Укук жетишсиз болсо, администратор туташтырат.",
          "Review name and barcode matches, including in quick creation. Choose Use this product on the matching card, compare its unit and variant, select stores and review the preview. This connects the existing product; draft fields from the new card are not copied onto it. Ask an administrator when your access does not permit reuse.",
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
          "До проведения проверьте предупреждение об ассортименте. Администратор или владелец может нажать «Подключить товары к ассортименту», выбрать исходный каталог и подтвердить предпросмотр только выбранных товаров. Если доступ для продажи пока не нужен, явно выберите проведение только в складской учёт. В проведённом документе блок остатков получателя показывает точные карточки и их текущую доступность. Подключение уже полученного товара не требует повторного перемещения.",
          "Өткөрүүдөн мурун ассортимент эскертүүсүн текшериңиз. Администратор же ээси «Товарларды ассортиментке туташтыруу» баскычын басып, баштапкы каталогду тандап, тандалган товарлардын алдын ала көрүнүшүн ырастай алат. Сатууга жеткиликтүүлүк азырынча керек болбосо, кампа эсебине гана өткөрүүнү так тандаңыз. Өткөрүлгөн документте алуучунун так карточкалары жана учурдагы жеткиликтүүлүгү көрсөтүлөт. Алынган товарды туташтыруу кайра көчүрүүнү талап кылбайт.",
          "Before posting, review the assortment warning. An administrator or owner can choose Connect products to assortment, select the original catalog and approve only the selected products. If sale access is not needed yet, explicitly choose inventory-only posting. The posted document shows the exact recipient cards and their current availability. Connecting received stock never requires another transfer.",
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
        title: t("Подготовьте цены выбранных магазинов", "Тандалган дүкөндөрдүн бааларын даярдаңыз", "Prepare destination prices"),
        body: t(
          "В действиях карточки выберите «Использовать в магазинах» или нажмите иконку подготовки у строки перемещения. Выберите получателей и источник цен. По умолчанию цены не меняются; режим заполнения пропусков сохраняет заданные значения, включая ноль. Замена цен требует проверки значений до/после и делает изменённые виды цен индивидуальными. Фото и характеристики у одной карточки уже общие. Для постоянного следования ценам используйте общий прайс. Остатки и документы подготовка не меняет.",
          "Карточканын аракеттеринен «Дүкөндөрдө колдонуу» тандаңыз же которуу сабындагы даярдоо белгисин басыңыз. Алуучуларды жана баа булагын тандаңыз. Демейки боюнча баалар өзгөрбөйт; боштуктарды толтуруу режими коюлган маанилерди, анын ичинде нөлдү сактайт. Алмаштыруу мурунку/жаңы маанилерди текшерүүнү талап кылып, өзгөргөн баа түрлөрүн жеке кылат. Бир карточканын сүрөттөрү жана мүнөздөмөлөрү жалпы. Туруктуу баа шайкештиги үчүн жалпы тизмени колдонуңуз. Даярдоо калдыктарды жана документтерди өзгөртпөйт.",
          "Choose Use in stores from the product actions, or the preparation icon on a transfer line. Select destinations and a price source. Prices stay unchanged by default; fill-missing preserves existing values including zero. Replacement requires reviewing before/after values and makes changed price kinds individual. Photos and details already belong to the shared card. Use a shared price list for ongoing price inheritance. Preparation does not change stock or documents.",
        ),
      },
      {
        title: t("Проверьте направление и прежние повторы", "Багытты жана мурунку кайталанууларды текшериңиз", "Review direction and existing candidates"),
        body: t(
          "В ассортименте выбран получатель: стрелка показывает, откуда приходят товары. Общая доступность включает подключённые источники, а собственный источник показывает товары, которые можно передавать дальше. Название «Склад» не делает точку главной. Перед изменением связей проверьте добавления и скрытия. В разделе товаров администратор может открыть «Проверить повторяющиеся карточки» и сравнить штрихкоды, варианты, магазины с остатками и связанную историю. Совпадение названий не является основанием для автоматического объединения. При корректировке подсказка показывает другие карточки и их остатки. Если копия показывает ноль, проверьте исходную через «Не в ассортименте»: не прибавляйте уже учтённый запас повторно. Прежние корректировки сверяют с физическим наличием и историей. Полученные из чужого каталога товары подключают из их настоящего источника.",
          "Ассортиментте алуучу тандалат: жебе товарлар кайдан келерин көрсөтөт. Жалпы жеткиликтүүлүк туташкан булактарды камтыйт, өз булагы андан ары берилүүчү товарларды көрсөтөт. «Кампа» аталышы чекитти башкы кылбайт. Байланыштарды өзгөртүүдөн мурда кошууларды жана жашырууларды текшериңиз. Товарлардан администратор «Кайталанган карточкаларды текшерүү» ачып, штрихкоддорду, варианттарды, калдыгы бар дүкөндөрдү жана тарыхты салыштыра алат. Аталыштардын дал келиши автоматтык бириктирүүгө негиз болбойт. Оңдоодо сунуш башка карточкаларды жана калдыктарын көрсөтөт. Көчүрмөдө нөл болсо, баштапкы карточканы «Ассортиментте жок» аркылуу текшериңиз: эсепке алынган калдыкты кайра кошпоңуз. Мурунку оңдоолор чыныгы калдык жана тарых менен салыштырылат. Башка каталогдон алынган товарлар чыныгы булагынан туташтырылат.",
          "The assortment editor selects a recipient; arrows show incoming sources. Total availability includes connected sources, while the own source contains products eligible for onward sharing. A warehouse name does not assign master status. Review additions and exclusions before changing connections. In Products, administrators can open Duplicate candidate review to compare barcodes, variants, stores with stock and related history. Matching names never authorize automatic merging. Stock editing shows other cards and their balances. If a copy shows zero, inspect the original under Not in assortment: do not add already recorded stock again. Reconcile old corrections against physical counts and history. Inherited warehouse goods must be connected from their actual original catalog.",
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
    relatedGuides: ["products/add-product", "products/import-products", "products/shared-prices", "inventory/transfer"],
  },
];
