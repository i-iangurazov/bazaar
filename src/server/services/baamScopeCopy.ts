import type { BaamClarification, BaamScopeReason } from "@/server/services/baamQuestionScope";
type Locale = "en" | "ru" | "kg";
const reasons: Record<Locale, Record<BaamScopeReason, string>> = {
  en: {
    controls: "Dates selected in the controls.",
    context: "Dates from the previous answer.",
    today: "Today in Bishkek time; the day is still in progress.",
    yesterday: "The previous complete day in Bishkek time.",
    complete_days: "Previous complete days, ending yesterday.",
    complete_weeks: "Previous complete seven-day periods, ending yesterday.",
    complete_months: "Previous complete calendar months; the current month is excluded.",
    month_to_date: "From the first of this month through today; today is incomplete.",
    calendar_week: "The previous complete calendar week, Monday through Sunday.",
    explicit_dates: "The explicitly requested dates, including both endpoints.",
    named_months: "The explicitly requested complete calendar months and year.",
  },
  ru: {
    controls: "Даты выбраны в фильтрах.",
    context: "Даты из предыдущего ответа.",
    today: "Сегодня по времени Бишкека; день ещё не завершён.",
    yesterday: "Предыдущий полный день по времени Бишкека.",
    complete_days: "Предыдущие полные дни, заканчивая вчерашним.",
    complete_weeks: "Предыдущие полные семидневные периоды, заканчивая вчерашним днём.",
    complete_months: "Предыдущие полные календарные месяцы; текущий месяц не включён.",
    month_to_date: "С первого числа текущего месяца по сегодня; сегодняшний день не завершён.",
    calendar_week: "Предыдущая полная календарная неделя, с понедельника по воскресенье.",
    explicit_dates: "Указанные даты, включая обе границы периода.",
    named_months: "Указанные полные календарные месяцы и год.",
  },
  kg: {
    controls: "Күндөр чыпкаларда тандалды.",
    context: "Күндөр мурунку жооптон алынды.",
    today: "Бишкек убактысы боюнча бүгүн; күн бүтө элек.",
    yesterday: "Бишкек убактысы боюнча мурунку толук күн.",
    complete_days: "Кечээ менен аяктаган мурунку толук күндөр.",
    complete_weeks: "Кечээ менен аяктаган мурунку толук жети күндүк мезгилдер.",
    complete_months: "Мурунку толук календардык айлар; учурдагы ай кошулбайт.",
    month_to_date: "Ушул айдын биринчи күнүнөн бүгүнкүгө чейин; бүгүнкү күн бүтө элек.",
    calendar_week: "Мурунку толук календардык апта, дүйшөмбүдөн жекшембиге чейин.",
    explicit_dates: "Көрсөтүлгөн күндөр, мезгилдин эки чеги тең кошулат.",
    named_months: "Көрсөтүлгөн толук календардык айлар жана жыл.",
  },
};
const clarification: Record<Locale, Record<BaamClarification, string>> = {
  en: {
    product: "Please provide the exact product name, SKU or barcode, or open its product page.",
    product_comparison:
      "I can show product results for one period, but cannot yet compare product rankings or product-specific sales measures across periods. Ask for a product ranking in a specified period, or compare overall sales.",
    date: "Which exact dates do you mean? Include a year for named months, or select the dates above. For example: Summarize sales from 2026-07-01 to 2026-08-31.",
    store:
      "Which accessible store do you mean? Choose one in the store control, or use its exact unique name. Comparing individual stores is not supported yet.",
    context:
      "The previous answer's context is no longer valid. Please ask a complete question with the dates and store you want.",
    range: "Choose a valid period of 1 to 366 days, with the start on or before the end.",
  },
  ru: {
    product: "Укажите точное название, артикул или штрихкод товара либо откройте его карточку.",
    product_comparison:
      "Я могу показать результаты товаров за один период, но пока не сравниваю рейтинги и показатели отдельных товаров между периодами. Запросите рейтинг за конкретный период или сравните общие продажи.",
    date: "Какие именно даты вы имеете в виду? Для названия месяца укажите год или выберите даты выше. Например: Подведи итоги продаж с 2026-07-01 по 2026-08-31.",
    store:
      "Какой доступный магазин вы имеете в виду? Выберите его в фильтре или укажите точное уникальное название. Сравнение отдельных магазинов пока не поддерживается.",
    context:
      "Контекст предыдущего ответа больше недействителен. Задайте полный вопрос с нужными датами и магазином.",
    range: "Выберите корректный период от 1 до 366 дней: начало не должно быть позже окончания.",
  },
  kg: {
    product: "Товардын так атын, артикулун же штрихкодун жазыңыз же анын барагын ачыңыз.",
    product_comparison:
      "Товарлардын жыйынтыгын бир мезгил үчүн көрсөтө алам, бирок товар рейтингдерин жана өзүнчө товар көрсөткүчтөрүн мезгилдер арасында азырынча салыштырбайм. Так мезгилге рейтинг сураңыз же жалпы сатууну салыштырыңыз.",
    date: "Так кайсы күндөрдү айтып жатасыз? Айдын аталышына жылын кошуңуз же жогорудан күндөрдү тандаңыз. Мисалы: 2026-07-01 — 2026-08-31 мезгилиндеги сатууну жыйынтыкта.",
    store:
      "Кайсы жеткиликтүү дүкөндү айтып жатасыз? Чыпкадан тандаңыз же так, уникалдуу атын жазыңыз. Өзүнчө дүкөндөрдү салыштыруу азырынча колдоого алынбайт.",
    context:
      "Мурунку жооптун контексти жараксыз болуп калды. Керектүү күндөрдү жана дүкөндү көрсөтүп, толук суроо бериңиз.",
    range:
      "1 күндөн 366 күнгө чейинки туура мезгилди тандаңыз: башталышы аяктагандан кийин болбошу керек.",
  },
};
export const baamScopeReason = (locale: Locale, reason: BaamScopeReason) => reasons[locale][reason];
export const baamClarification = (locale: Locale, reason: BaamClarification) =>
  clarification[locale][reason];
export const baamClarificationSuggestions = (locale: Locale) =>
  ({
    en: [
      "Summarize sales for the last two months",
      "Summarize sales for yesterday",
      "Summarize sales for the selected dates and stores",
    ],
    ru: [
      "Подведи итоги продаж за последние два месяца",
      "Подведи итоги продаж за вчера",
      "Подведи итоги продаж за выбранные даты и магазины",
    ],
    kg: [
      "Акыркы эки айдагы сатууну жыйынтыкта",
      "Кечээки сатууну жыйынтыкта",
      "Тандалган күндөр жана дүкөндөр боюнча сатууну жыйынтыкта",
    ],
  })[locale];
