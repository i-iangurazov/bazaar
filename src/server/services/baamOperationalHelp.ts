import { getHelpGuideById, helpGuideId } from "@/content/help/catalog";
import { baamText, type BaamLocale, type BaamPart, type BaamPrinterDetails, type BaamSend } from "@/lib/baam/companion";
import { getBaamNavigationDestination, type BaamNavigationContext } from "@/lib/baamNavigation";
import { canAccessAppRoute, hasPermission } from "@/lib/roleAccess";
import { businessDateKey } from "@/lib/timezone";
import { resolveBaamQuestionScope } from "./baamQuestionScope";

type HelpTopic = "printer" | "sale" | "billing" | "instruction";
type HelpAnswer = { text: string; parts: BaamPart[] };
type HelpAccess = BaamNavigationContext & { stores: ReadonlyArray<{ id: string; name: string }> };

const normalized = (text: string) => text.normalize("NFKC").trim().toLowerCase().replaceAll("ё", "е");

export const asksForBaamInstructions = (text: string) =>
  /(?:инструкци\p{L}*|пошагов\p{L}*|шаг за шагом|чек[- ]?лист|\b(?:instructions?|walkthrough|step[- ]by[- ]step|how[- ]to guide|checklist)\b|нускама\p{L}*|кадам\s*[-–]бы\s*кадам)/iu.test(text) &&
  !/^(?:создай|добавь|обнови|create|add|update)\s+(?:an?\s+)?(?:товар\p{L}*|клиент\p{L}*|product|customer)\s/iu.test(text.trim());

export const asksBaamAboutPersonalHealth = (text: string) =>
  /(?:болит (?:голова|живот|спина|горло|грудь)|головн\p{L}* бол\p{L}*|как лечить|что (?:делать|пить).{0,45}(?:болит|тошнит|температур|давлен)|у меня (?:кашель|насморк|тошнота|температур\p{L}*|давлен\p{L}*|бессонниц\p{L}*)|\b(?:my (?:head|stomach|throat) hurts|headaches?|chest pain|shortness of breath|how to treat my|health symptoms)\b|башым ооруйт|ичим ооруйт|дене табым)/iu.test(text);

export function baamOperationalTopic(input: Pick<BaamSend, "text" | "command" | "page">): HelpTopic | null {
  const text = normalized(input.text);
  if (input.command) {
    if (input.command.kind !== "help") return null;
    if (input.command.query === "printing") return "printer";
    if (input.command.query === "make-sale") return "sale";
    if (input.command.query === "billing") return "billing";
  }
  const instruction = asksForBaamInstructions(text);
  const printTopic = /(?:принтер\p{L}*|настройк\p{L}* печат\p{L}*|печат\p{L}* (?:чек\p{L}*|ценник\p{L}*|этикет\p{L}*)|\b(?:printers?|print settings|label printing|receipt printing)\b|басып чыгар\p{L}*)/u.test(text);
  if (printTopic && (instruction ||
      /(?:^(?:принтер|printer|настройки печати|printing settings)[?.!]*$|как |где |настро\p{L}*|подключ\p{L}*|не печата\p{L}*|печат\p{L}* криво|\b(?:how|setup|set up|connect|not printing|doesn't print)\b|кантип|туташтыр\p{L}*)/u.test(text)))
    return "printer";
  if (/(?:подписк\p{L}*|тариф\p{L}* bazaar|оплат\p{L}* (?:тариф\p{L}*|bazaar)|\b(?:billing|subscription|pricing plan)\b|жазылуу\p{L}*|(?:тариф|тарифти) (?:төлө\p{L}*|алмаштыр\p{L}*))/u.test(text) ||
    /^(?:какой (?:у нас|у меня) тариф|тарифы|какие тарифы|где тарифы)[?.!]*$/u.test(text))
    return "billing";
  if (/(?:как\s+(?:оформ\p{L}*|сдела\p{L}*|прове\p{L}*|созда\p{L}*)\s+(?:первую\s+)?продаж\p{L}*|как (?:пробить чек|продать товар|провести оплату на кассе)|\b(?:how (?:do i |to )(?:make|record|complete|ring up) (?:a )?sale|sales? checkout guide)\b|сатууну кантип|чекти кантип чыгар)/u.test(text) ||
    (instruction && /(?:продаж\p{L}*|касс\p{L}*|\b(?:sale|checkout|cashier)\b|сатуу)/u.test(text)))
    return "sale";
  if (!instruction) return null;
  const bareInstruction = /^(?:(?:составь|подготовь|напиши|дай|сделай|можешь подготовить) (?:мне )?(?:пошаговую |короткую )?инструкцию|(?:write|prepare|make)(?: me)? (?:an? )?(?:short |step-by-step )?(?:guide|instruction|checklist)s?|нускама (?:даярда|жаз|бер))[?.!]*$/u.test(text);
  if (!bareInstruction) return null;
  if (input.page?.path === "/settings/printing") return "printer";
  if (input.page?.path === "/pos" || input.page?.path === "/pos/sell") return "sale";
  if (input.page?.path === "/billing") return "billing";
  return "instruction";
}

export function readBaamPrinterDetails(text: string): BaamPrinterDetails {
  const source = text.normalize("NFKC");
  const model = source.match(/\b(?:xprinter|zebra|epson|brother|tsc|star|rongta|citizen|honeywell|gprinter|godex|canon|hp|bixolon|munbyn)\s+[a-z][a-z0-9-]*\d[a-z0-9-]*\b/i)?.[0] ??
    source.match(/\b(?:XP|ZD|TM|QL|GK|TSP|BTP|POS)[ -]?\d[a-z0-9-]{1,12}\b/i)?.[0];
  const label = /(?:этикет\p{L}*|ценник\p{L}*|наклейк\p{L}*|\blabels?\b)/iu.test(source);
  const receipt = /(?:чек\p{L}*|\breceipts?\b)/iu.test(source);
  const format = source.match(/(?<![\p{L}\p{N}])(\d{2,3}(?:[.,]\d)?)\s*[xх×*]\s*(\d{2,3}(?:[.,]\d)?)(?!\d)/iu);
  const roll = source.match(/(?<!\d)(\d{2,3}(?:[.,]\d)?)\s*(?:мм|mm)(?![\p{L}\p{N}])/iu);
  const width = Number((format?.[1] ?? roll?.[1] ?? "").replace(",", "."));
  const height = Number((format?.[2] ?? "").replace(",", "."));
  const connection = /(?:\busb\b|юсб)/iu.test(source) ? "USB"
    : /(?:wi[ -]?fi|вай[ -]?фай)/iu.test(source) ? "Wi-Fi"
    : /(?:bluetooth|блютуз)/iu.test(source) ? "Bluetooth"
    : /(?:ethernet|\blan\b|сетев\p{L}* кабел\p{L}*)/iu.test(source) ? "Ethernet" : undefined;
  const device = source.match(/\b(?:Windows(?:\s+(?:10|11))?|macOS|MacBook|Mac|Linux|iPhone|iPad|iOS|Android)\b/i)?.[0];
  return {
    ...(model ? { model } : {}),
    ...(label !== receipt ? { media: label ? "label" : "receipt" } : {}),
    ...(width >= 20 && width <= 320 ? { width } : {}),
    ...(height >= 10 && height <= 350 ? { height } : {}),
    ...(connection ? { connection } : {}),
    ...(device ? { device } : {}),
  };
}

export function baamGuideLink(guideId: string, locale: BaamLocale, access: BaamNavigationContext): BaamPart[] {
  const guide = getHelpGuideById(guideId);
  if (!guide || !getBaamNavigationDestination("help", access) || !canAccessAppRoute(guide.appRoute, access.access)) return [];
  return [{ type: "link", label: guide.title[locale], href: `/help/${helpGuideId(guide)}` }];
}

export function answerBaamOperationalHelp(input: {
  topic: HelpTopic;
  text: string;
  locale: BaamLocale;
  access: HelpAccess;
  storeId?: string;
  previousPrinter?: BaamPrinterDetails;
}): HelpAnswer {
  const { topic, text, locale, access } = input;
  const t = (ru: string, en: string, kg: string) => baamText(locale, ru, en, kg);
  if (topic === "instruction") {
    return { text: t(
      "Составлю пошаговую инструкцию. Напишите, какую задачу нужно выполнить и для кого она. Например, как кассиру впервые открыть смену.",
      "I can write a step-by-step guide. What task should it cover, and who will use it? For example, a cashier opening their first shift.",
      "Кадамдык нускама даярдайм. Кайсы ишти жана ким үчүн түшүндүрөлү? Мисалы, нөөмөттү биринчи жолу ачкан кассир үчүн.",
    ), parts: [] };
  }
  if (topic === "billing") {
    const destination = getBaamNavigationDestination("billing", access);
    return destination ? {
      text: t(
        "В разделе «Подписка и оплата» можно посмотреть текущий тариф, статус доступа и доступные варианты продления.\n\nЕсли нужно продлить или сменить тариф, откройте раздел ниже, выберите подходящий вариант и проверьте период и сумму перед подтверждением.",
        "Open Subscription and billing to check the current plan, access status and available renewal options.\n\nTo renew or change plans, choose an available option and review the term and total before confirming.",
        "«Жазылуу жана төлөм» бөлүмүнөн учурдагы тарифти, кирүү абалын жана узартуу жолдорун көрөсүз.\n\nУзартуу же тарифти өзгөртүү үчүн вариантты тандап, ырастоодон мурун мөөнөтүн жана суммасын текшериңиз.",
      ), parts: [{ type: "link", label: destination.label, href: destination.href }],
    } : { text: t(
      "Тарифом и оплатой управляет администратор организации. Попросите его проверить текущий статус в разделе «Подписка и оплата». Если вопрос о том, какой тариф выбрать, расскажите, для каких задач нужен Bazaar.",
      "An organization administrator manages the plan and payments. Ask them to check Subscription and billing. If you are comparing plans, tell me what you need Bazaar to do.",
      "Тарифти жана төлөмдү уюмдун администратору башкарат. Андан «Жазылуу жана төлөм» бөлүмүн текшерүүсүн сураныңыз. Тариф тандап жатсаңыз, Bazaar кайсы иштер үчүн керек экенин жазыңыз.",
    ), parts: [] };
  }
  if (topic === "sale") {
    if (!hasPermission(access.access, "usePos") || !canAccessAppRoute("/pos", access.access))
      return { text: t("Попросите администратора предоставить доступ к кассе.", "Ask an administrator for register access.", "Администратордон кассага кирүү укугун сураныңыз."), parts: [] };
    const date = businessDateKey(new Date());
    const scope = resolveBaamQuestionScope({
      question: text, selected: { dateFrom: date, dateTo: date, storeId: input.storeId }, stores: access.stores,
    });
    if (scope.status === "clarification" && scope.clarification === "store")
      return { text: t(
        "В каком магазине оформляете продажу? Напишите его название, как оно указано в Bazaar.",
        "Which store is the sale for? Enter its name as shown in Bazaar.",
        "Сатуу кайсы дүкөндө болот? Аталышын Bazaar'да көрсөтүлгөндөй жазыңыз.",
      ), parts: [] };
    const storeId = scope.status === "resolved" ? scope.storeId : input.storeId;
    const store = access.stores.find((entry) => entry.id === storeId) ??
      (access.stores.length === 1 ? access.stores[0] : undefined);
    const start = store
      ? t(`Откройте кассу магазина «${store.name}».`, `Open the register area for ${store.name}.`, `«${store.name}» дүкөнүнүн кассасын ачыңыз.`)
      : t("Откройте «Касса» и выберите магазин и кассу.", "Open Point of sale and choose a store and register.", "«Касса» бөлүмүн ачып, дүкөн менен кассаны тандаңыз.");
    return {
      text: [start, t(
        "1. Выберите кассу и откройте смену, если она ещё не открыта.\n2. Добавьте товар по названию или штрихкоду. Проверьте количество, цену и скидку.\n3. Перейдите к оплате, выберите способ и проверьте полученную сумму.\n4. Завершите чек после получения оплаты.",
        "1. Choose the register and open a shift if one is not open.\n2. Add a product by name or barcode. Check the quantity, price and discount.\n3. Go to Payment, choose the method and verify the received amount.\n4. Complete the receipt after receiving payment.",
        "1. Кассаны тандаңыз. Нөөмөт ачыла элек болсо, ачыңыз.\n2. Товарды аты же штрихкоду менен кошуңуз. Санын, баасын жана арзандатуусун текшериңиз.\n3. Төлөмгө өтүп, ыкмасын жана алынган сумманы текшериңиз.\n4. Төлөмдү алгандан кийин чекти бүтүрүңүз.",
      )].join("\n\n"),
      parts: [
        { type: "link", label: t("Открыть кассу", "Open point of sale", "Кассаны ачуу"), href: store ? `/pos?store=${encodeURIComponent(store.id)}` : "/pos" },
        ...baamGuideLink("pos/make-sale", locale, access),
      ],
    };
  }

  const supplied = readBaamPrinterDetails(text);
  const matching = !supplied.model || !input.previousPrinter?.model ||
    normalized(supplied.model) === normalized(input.previousPrinter.model);
  const printer = { ...(matching ? input.previousPrinter : undefined), ...supplied };
  const destination = getBaamNavigationDestination("printing", access);
  const parts: BaamPart[] = [{ type: "printerHelpContext", details: printer }];
  if (!destination) return { text: t(
    "Для настройки печати попросите доступ у администратора. Подготовьте модель принтера, размеры бумаги или этикетки, подключение и устройство, с которого печатаете.",
    "Ask an administrator for printing settings access. Have the printer model, paper or label size, connection and printing device ready.",
    "Басып чыгарууну жөндөө үчүн администратордон уруксат сураңыз. Принтердин моделин, кагаз же этикетканын өлчөмүн, туташуусун жана түзмөктү тактаңыз.",
  ), parts };
  parts.unshift({ type: "link", label: destination.label, href: destination.href });
  const missing = [
    !printer.model && t("модель принтера", "printer model", "принтердин модели"),
    !printer.media && t("что печатаете — чеки или этикетки", "whether you print receipts or labels", "чекпи же этикеткабы"),
    (!printer.width || (printer.media === "label" && !printer.height)) &&
      t("размер бумаги или этикетки в мм", "paper or label size in mm", "кагаз же этикетканын өлчөмү (мм)"),
    !printer.connection && t("подключение (USB, Wi-Fi или Bluetooth)", "connection (USB, Wi-Fi or Bluetooth)", "туташуу (USB, Wi-Fi же Bluetooth)"),
    !printer.device && t("устройство и систему", "device and operating system", "түзмөк жана иштетүү системасы"),
  ].filter(Boolean);
  if (missing.length) {
    return { text: t(
      `Помогу настроить печать. Для точных шагов напишите ${missing.join(", ")}.\n\nПока проверьте, видит ли ваше устройство принтер. В Bazaar можно открыть настройки печати и выбрать нужный магазин.`,
      `I can help set it up. For exact steps, please share ${missing.join(", ")}.\n\nMeanwhile, check that your device can see the printer. Open Printing settings in Bazaar and choose the store.`,
      `Басып чыгарууну жөндөөгө жардам берем. Так кадамдар үчүн ${missing.join(", ")} жазыңыз.\n\nАзыр түзмөк принтерди көрүп жатканын текшериңиз. Bazaar'да басып чыгаруу жөндөөлөрүн ачып, дүкөндү тандаңыз.`,
    ), parts };
  }
  const size = printer.media === "label" ? `${printer.width}×${printer.height}` : String(printer.width);
  const setup = t(
    `**${printer.model} · ${printer.connection} · ${printer.device}**\n\n1. Убедитесь, что устройство видит принтер и печатает пробную страницу. Если принтера нет в списке, проверьте подключение и инструкции производителя для вашей системы.\n2. Откройте «Настройки печати» в Bazaar и выберите свой магазин.`,
    `**${printer.model} · ${printer.connection} · ${printer.device}**\n\n1. Check that the device can see the printer and print a test page. If it is missing, check the connection and the manufacturer's instructions for your operating system.\n2. Open Printing settings in Bazaar and choose your store.`,
    `**${printer.model} · ${printer.connection} · ${printer.device}**\n\n1. Түзмөк принтерди көрүп, сыноо барагын чыгара аларын текшериңиз. Тизмеде жок болсо, туташууну жана өндүрүүчүнүн нускамасын караңыз.\n2. Bazaar'да басып чыгаруу жөндөөлөрүн ачып, дүкөндү тандаңыз.`,
  );
  const printing = printer.media === "label" ? t(
    `3. В «Настройке штрихкодов / ценников» задайте размер **${size} мм** и сохраните.\n4. Откройте PDF ценника из Bazaar. В окне печати выберите этот же размер и масштаб 100%. Напечатайте одну этикетку и проверьте, что края и штрихкод помещаются.`,
    `3. In Barcode and price label settings, set **${size} mm** and save.\n4. Open the label PDF from Bazaar. Use the same paper size and 100% scale. Print one label and check the edges and barcode.`,
    `3. Штрихкод жана баа кагазынын жөндөөлөрүндө **${size} мм** өлчөмүн коюп, сактаңыз.\n4. Bazaar'дан PDF этикетканы ачыңыз. Ошол өлчөмдү жана 100% масштабды тандап, бир этикеткада четтерин жана штрихкодду текшериңиз.`,
  ) : t(
    `3. В «Настройке чека» выберите ширину бумаги **${size} мм** и сохраните.\n4. Нажмите «Тестовая печать чека», выберите свой принтер и проверьте, что строки помещаются по ширине.`,
    `3. In Receipt settings, set the paper width to **${size} mm** and save.\n4. Select Test receipt printing, choose the printer and check that the lines fit.`,
    `3. Чек жөндөөлөрүндө кагаздын туурасын **${size} мм** кылып, сактаңыз.\n4. Сыноо чегин басып чыгарууну тандаңыз. Принтерди тандап, саптар толук батып жатканын текшериңиз.`,
  );
  return { text: `${setup}\n${printing}`, parts };
}
