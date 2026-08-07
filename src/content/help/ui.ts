import type { HelpLocale, LocalizedText } from "./types";

const text = (ru: string, kg: string, en: string): LocalizedText => ({ ru, kg, en });

export const helpUi = {
  productName: text("Bazaar Guide", "Bazaar Guide", "Bazaar Guide"),
  home: text("Главная", "Башкы бет", "Home"),
  guides: text("Инструкции", "Нускамалар", "Guides"),
  searchTitle: text("Как вам помочь?", "Сизге кантип жардам беребиз?", "How can we help?"),
  searchPlaceholder: text(
    "Например: «как закрыть смену»",
    "Мисалы: «сменаны кантип жабам»",
    "For example: “how to close a shift”",
  ),
  searchLabel: text("Поиск по Bazaar Guide", "Bazaar Guide боюнча издөө", "Search Bazaar Guide"),
  searchResults: text("Подходящие инструкции", "Туура келген нускамалар", "Matching guides"),
  noResults: text(
    "Ничего не нашли. Попробуйте описать задачу другими словами.",
    "Эч нерсе табылган жок. Тапшырманы башка сөздөр менен жазыңыз.",
    "Nothing matched. Try describing the task in different words.",
  ),
  viewAll: text("Все инструкции", "Бардык нускамалар", "All guides"),
  tasksTitle: text("Что вы хотите сделать?", "Эмне кылгыңыз келет?", "What do you want to do?"),
  tasksSubtitle: text(
    "Выберите привычную задачу — терминологию Bazaar знать не нужно.",
    "Көнүмүш тапшырманы тандаңыз — Bazaar терминдерин билүүнүн кереги жок.",
    "Choose a familiar task — you do not need to know Bazaar terminology.",
  ),
  journeyTitle: text(
    "Начните работу с Bazaar",
    "Bazaar менен ишти баштаңыз",
    "Get started with Bazaar",
  ),
  journeySubtitle: text(
    "Шесть коротких шагов до первой продажи и понятного результата.",
    "Биринчи сатууга жана түшүнүктүү жыйынтыкка чейинки алты кыска кадам.",
    "Six short steps to your first sale and a clear result.",
  ),
  markDone: text("Отметить готовым", "Даяр деп белгилөө", "Mark complete"),
  completed: text("Готово", "Даяр", "Complete"),
  resetProgress: text("Сбросить прогресс", "Прогрессти тазалоо", "Reset progress"),
  roleTitle: text("Я работаю как...", "Менин ролум...", "I work as..."),
  roleSubtitle: text(
    "Быстрые подборки по роли. Остальные инструкции остаются доступны.",
    "Роль боюнча тез тандоо. Башка нускамалар да жеткиликтүү.",
    "Role-based shortcuts. Every other guide stays available.",
  ),
  categoriesTitle: text("Все разделы", "Бардык бөлүмдөр", "All sections"),
  minutes: text("мин", "мүн", "min"),
  guideCount: text("инструкций", "нускама", "guides"),
  openGuide: text("Открыть инструкцию", "Нускаманы ачуу", "Open guide"),
  backToHelp: text("Назад в Bazaar Guide", "Bazaar Guide'га кайтуу", "Back to Bazaar Guide"),
  onThisPage: text("В этой инструкции", "Бул нускамада", "In this guide"),
  step: text("Шаг", "Кадам", "Step"),
  zoomImage: text("Увеличить изображение", "Сүрөттү чоңойтуу", "Zoom image"),
  closeImage: text("Закрыть изображение", "Сүрөттү жабуу", "Close image"),
  imageHint: text("Нажмите, чтобы увеличить", "Чоңойтуу үчүн басыңыз", "Tap to zoom"),
  success: text("Готово", "Даяр", "Done"),
  openInBazaar: text("Открыть в Bazaar", "Bazaar'да ачуу", "Open in Bazaar"),
  troubleshooting: text(
    "Что делать, если не получается?",
    "Иштебей жатса эмне кылуу керек?",
    "What if it does not work?",
  ),
  support: text("Связаться с поддержкой", "Колдоо кызматына жазуу", "Contact support"),
  related: text("Что сделать дальше", "Андан ары эмне кылуу керек", "What to do next"),
  feedback: text(
    "Эта инструкция помогла?",
    "Бул нускама жардам бердиби?",
    "Was this guide helpful?",
  ),
  feedbackYes: text("Да", "Ооба", "Yes"),
  feedbackNo: text("Нет", "Жок", "No"),
  feedbackThanks: text("Спасибо за ответ", "Жообуңуз үчүн рахмат", "Thanks for your feedback"),
  categoryEmpty: text(
    "Новые инструкции для этого раздела уже готовятся.",
    "Бул бөлүм үчүн жаңы нускамалар даярдалып жатат.",
    "More guides for this section are being prepared.",
  ),
  menu: text("Открыть меню", "Менюну ачуу", "Open menu"),
  closeMenu: text("Закрыть меню", "Менюну жабуу", "Close menu"),
  signIn: text("Войти в Bazaar", "Bazaar'га кирүү", "Sign in to Bazaar"),
  startFree: text("Начать бесплатно", "Акысыз баштоо", "Start free"),
  language: text("Язык", "Тил", "Language"),
  desktop: text("Компьютер", "Компьютер", "Desktop"),
  mobile: text("Телефон", "Телефон", "Mobile"),
  updated: text(
    "Проверено на актуальной версии Bazaar",
    "Bazaar'дын учурдагы версиясында текшерилди",
    "Verified on the current Bazaar version",
  ),
} satisfies Record<string, LocalizedText>;

export const localize = (value: LocalizedText, locale: HelpLocale) => value[locale] ?? value.ru;

export const localizedUi = (locale: HelpLocale) =>
  Object.fromEntries(
    Object.entries(helpUi).map(([key, value]) => [key, localize(value, locale)]),
  ) as { [Key in keyof typeof helpUi]: string };

export { text as helpText };
