import { baamText } from "./companion";

const copy = {
  name: ["BAAM", "BAAM", "BAAM"],
  subtitle: ["Помощник в делах", "Your business companion", "Иштериңизге жардамчы"],
  open: ["Открыть помощника BAAM", "Open BAAM assistant", "BAAM жардамчысын ачуу"],
  workspace: ["Открыть на всю страницу", "Open full page", "Толук баракта ачуу"],
  history: ["Диалоги", "Conversations", "Маектер"],
  back: ["К диалогу", "Back to conversation", "Маекке кайтуу"],
  new: ["Новый диалог", "New conversation", "Жаңы маек"],
  rename: ["Переименовать", "Rename", "Атын өзгөртүү"],
  remove: ["Удалить диалог", "Delete conversation", "Маекти өчүрүү"],
  save: ["Сохранить", "Save", "Сактоо"],
  cancel: ["Отмена", "Cancel", "Жокко чыгаруу"],
  emptyHistory: [
    "Здесь появятся ваши диалоги",
    "Your conversations will appear here",
    "Маектериңиз бул жерде көрүнөт",
  ],
  more: ["Загрузить ещё", "Load more", "Дагы жүктөө"],
  earlier: ["Ранние сообщения", "Earlier messages", "Мурунку билдирүүлөр"],
  welcome: ["Что нужно сделать?", "What can I help you do?", "Эмне кылуу керек?"],
  intro: [
    "Найдём товар, оформим документ или разберёмся в продажах. Напишите задачу своими словами.",
    "Find a product, prepare a document or understand your sales. Tell me what you need in your own words.",
    "Товар табалы, документ даярдайлы же сатууларды карайлы. Керектүү ишти өз сөзүңүз менен жазыңыз.",
  ],
  createProduct: ["Создать товар", "Create a product", "Товар түзүү"],
  receive: ["Оприходовать товары", "Receive stock", "Товарларды кириштөө"],
  sell: ["Подготовить продажу", "Prepare a sale", "Сатууну даярдоо"],
  sales: ["Как идут продажи за неделю?", "How are sales this week?", "Бул аптада сатуулар кандай?"],
  help: [
    "Помоги разобраться с этой страницей",
    "Help me with this page",
    "Бул барак менен иштөөгө жардам бер",
  ],
  placeholder: [
    "Напишите задачу или задайте вопрос…",
    "Describe a task or ask a question…",
    "Тапшырма жазыңыз же суроо бериңиз…",
  ],
  send: ["Отправить сообщение", "Send message", "Билдирүүнү жөнөтүү"],
  stop: ["Остановить ответ", "Stop response", "Жоопту токтотуу"],
  thinking: ["Разбираюсь в запросе…", "Working on your request…", "Сурооңузду карап жатам…"],
  latest: ["К последнему сообщению", "Jump to latest", "Акыркы билдирүүгө өтүү"],
  loading: ["Загрузка…", "Loading…", "Жүктөлүүдө…"],
  store: ["Магазин диалога", "Conversation store", "Маектин дүкөнү"],
  allStores: ["Выбрать при необходимости", "Choose when needed", "Керек болгондо тандоо"],
  storeChanged: [
    "Магазин изменён. Незавершённые действия нужно уточнить заново.",
    "Store changed. Review unfinished actions in the new context.",
    "Дүкөн өзгөрдү. Бүтө элек иштерди жаңы дүкөн үчүн тактаңыз.",
  ],
  execute: ["Выполнить", "Execute", "Аткаруу"],
  running: ["Выполняется…", "Executing…", "Аткарылууда…"],
  completed: ["Выполнено", "Completed", "Аткарылды"],
  proposed: ["Проверьте параметры", "Review details", "Маалыматтарды текшериңиз"],
  superseded: ["Параметры изменены", "Details superseded", "Маалыматтар өзгөртүлдү"],
  cancelled: ["Отменено", "Cancelled", "Жокко чыгарылды"],
  failed: ["Не удалось выполнить", "Could not complete", "Аткаруу мүмкүн болгон жок"],
  openResult: ["Открыть в Bazaar", "Open in Bazaar", "Bazaar ичинде ачуу"],
  continue: ["Продолжить задачу", "Continue the task", "Тапшырманы улантуу"],
  retry: ["Повторить", "Retry", "Кайталоо"],
  attach: ["Добавить фотографию", "Attach a photo", "Сүрөт кошуу"],
  removeAttachment: ["Убрать фотографию", "Remove photo", "Сүрөттү алып салуу"],
  microphone: ["Записать голосовое сообщение", "Record a voice message", "Үн билдирүүсүн жаздыруу"],
  recording: ["Идёт запись", "Recording", "Үн жазылууда"],
  stopRecording: ["Закончить запись", "Finish recording", "Жаздырууну бүтүрүү"],
  cancelRecording: ["Отменить запись", "Cancel recording", "Жаздырууну жокко чыгаруу"],
  transcription: ["Исходная расшифровка", "Original transcription", "Баштапкы чечмелөө"],
  transcribing: ["Распознаю речь…", "Transcribing…", "Үн таанылууда…"],
  reviewVoice: [
    "Проверьте названия, количества и суммы. Текст можно исправить перед отправкой.",
    "Check names, quantities and amounts. Edit the text before sending.",
    "Аттарды, сандарды жана суммаларды текшериңиз. Жөнөтүүдөн мурун текстти оңдосоңуз болот.",
  ],
  voiceSupport: [
    "Голос: русский, English, кыргызча · до 90 секунд",
    "Voice: русский, English, кыргызча · up to 90 seconds",
    "Үн: русский, English, кыргызча · 90 секундга чейин",
  ],
  micDenied: [
    "Доступ к микрофону закрыт. Разрешите его в настройках браузера или напишите сообщение.",
    "Microphone access is blocked. Allow it in browser settings or type your message.",
    "Микрофонго уруксат жок. Браузердин жөндөөлөрүнөн уруксат бериңиз же билдирүү жазыңыз.",
  ],
  micTimeout: [
    "Не удалось получить доступ к микрофону. Проверьте разрешение браузера или введите текст.",
    "Microphone access timed out. Check browser permissions or type your message.",
    "Микрофонго кирүү убактысы бүттү. Браузердин уруксатын текшериңиз же текст жазыңыз.",
  ],
  baamAlreadyCurrent: [
    "Такое количество уже указано. Изменение не требуется.",
    "This quantity is already recorded. No change is needed.",
    "Бул сан мурунтан көрсөтүлгөн. Өзгөртүүнүн кереги жок.",
  ],
  micMissing: [
    "Микрофон не найден. Текстовый ввод доступен.",
    "No microphone found. You can still type.",
    "Микрофон табылган жок. Текст жаза аласыз.",
  ],
  micUnsupported: [
    "Этот браузер не поддерживает запись. Используйте текстовый ввод.",
    "Recording is unavailable in this browser. Please type your message.",
    "Бул браузерде үн жаздыруу жеткиликсиз. Текст жазыңыз.",
  ],
  network: [
    "Нет связи с сервером. История сохранится; повторная отправка не создаст дубликат.",
    "Could not reach the server. History is preserved; retrying will not duplicate the request.",
    "Сервер менен байланыш жок. Тарых сакталат; кайталоо билдирүүнү кайталабайт.",
  ],
  unavailable: [
    "BAAM пока не настроен. История доступна, настройку нужно завершить администратору.",
    "BAAM is not configured yet. History is available; an administrator needs to finish setup.",
    "BAAM азырынча жөндөлө элек. Тарых жеткиликтүү; администратор жөндөөнү бүтүрүшү керек.",
  ],
  forbidden: [
    "BAAM доступен только администратору и менеджеру.",
    "BAAM is available to administrators and managers only.",
    "BAAM администратор жана менеджер үчүн гана жеткиликтүү.",
  ],
  baamBusy: [
    "В этом диалоге уже выполняется запрос. Дождитесь ответа или откройте новый диалог.",
    "This conversation is processing a request. Wait for it or start a new conversation.",
    "Бул маекте суроо аткарылууда. Күтүңүз же жаңы маек ачыңыз.",
  ],
  baamScopeChanged: [
    "Контекст изменился в другом окне. Обновите диалог и проверьте магазин.",
    "The context changed in another tab. Refresh the conversation and check its store.",
    "Башка терезеде контекст өзгөрдү. Маекти жаңыртып, дүкөндү текшериңиз.",
  ],
  baamStopped: [
    "Ответ остановлен. Выполненные ранее операции остаются в истории.",
    "Response stopped. Previously completed operations remain in history.",
    "Жооп токтотулду. Мурун аткарылган иштер тарыхта калат.",
  ],
  baamInterrupted: [
    "Ответ прервался. История сохранена — можно продолжить задачу.",
    "The response was interrupted. History is saved; you can continue the task.",
    "Жооп үзгүлтүккө учурады. Тарых сакталды — тапшырманы улантсаңыз болот.",
  ],
  baamCartChanged: [
    "Состав или цена чека изменились. Проверьте актуальный чек перед оплатой.",
    "The cart or its prices changed. Review the current sale before paying.",
    "Чектеги товарлар же баалар өзгөрдү. Төлөөдөн мурун чекти кайра текшериңиз.",
  ],
  baamRecordChanged: [
    "Объект изменился после подготовки действия. Запросите актуальные данные и проверьте параметры заново.",
    "This record changed after the action was prepared. Get the current details and review them again.",
    "Иш даярдалгандан кийин маалымат өзгөрдү. Учурдагы маалыматтарды алып, кайра текшериңиз.",
  ],
  baamPartialAction: [
    "Часть шагов уже выполнена. Откройте созданный документ, чтобы продолжить или отменить его штатным способом.",
    "Some steps are already completed. Open the created document to continue or cancel it through its normal workflow.",
    "Айрым кадамдар аткарылды. Түзүлгөн документти ачып, улантыңыз же кадимки жол менен жокко чыгарыңыз.",
  ],
  baamAudioAlreadySent: [
    "Эта запись уже отправлена. Откройте её сообщение в диалоге.",
    "This recording was already sent. Open its message in the conversation.",
    "Бул жазма жөнөтүлгөн. Маектеги билдирүүсүн ачыңыз.",
  ],
  baamAudioProcessing: [
    "Эта запись уже распознаётся. Подождите немного и повторите проверку.",
    "This recording is already being transcribed. Wait briefly and check again.",
    "Бул жазма таанылып жатат. Бир аз күтүп, кайра текшериңиз.",
  ],
  baamExistingCart: [
    "В этой кассе уже есть ваш черновик чека. Продолжите его или отложите перед новой продажей.",
    "You already have an active cart at this register. Continue or hold it before starting a new sale.",
    "Бул кассада чегиңиздин долбоору бар. Жаңы сатуудан мурун аны улантыңыз же кийинкиге калтырыңыз.",
  ],
  baamExecutionUncertain: [
    "Нужно проверить состояние операции. Автоматический повтор остановлен; откройте документ в Bazaar.",
    "The operation needs a status check. Automatic retry is stopped; open the document in Bazaar.",
    "Иштин абалын текшерүү керек. Автоматтык кайталоо токтотулду; документти Bazaar ичинде ачыңыз.",
  ],
  baamProviderUnavailable: [
    "Помощник временно не отвечает. Сообщение сохранено. Попробуйте продолжить чуть позже.",
    "The assistant is temporarily unavailable. Your message is saved. Try continuing shortly.",
    "Жардамчы убактылуу жооп бербей жатат. Билдирүү сакталды. Бир аздан кийин улантып көрүңүз.",
  ],
  baamAudioFormat: [
    "Не удалось прочитать запись. Запишите ещё раз или введите текст.",
    "Could not read this recording. Record again or type your message.",
    "Үн жазмасын окуу мүмкүн болгон жок. Кайра жаздырыңыз же текст жазыңыз.",
  ],
  baamAudioTooLong: [
    "Запись длиннее 90 секунд. Запишите более короткое сообщение.",
    "The recording is longer than 90 seconds. Please record a shorter message.",
    "Жазма 90 секунддан узун. Кыскараак билдирүү жаздырыңыз.",
  ],
  baamAudioTooLarge: [
    "Файл слишком большой. Максимум — 3 МБ.",
    "This file is too large. The limit is 3 MB.",
    "Файл өтө чоң. Чектөө — 3 МБ.",
  ],
  baamVoiceUnavailable: [
    "Не удалось распознать речь. Можно повторить отправку записи или написать текст.",
    "Could not transcribe the recording. Retry the upload or type your message.",
    "Үндү таануу мүмкүн болгон жок. Жазманы кайра жөнөтүңүз же текст жазыңыз.",
  ],
  baamAudioEmpty: [
    "Речь не обнаружена. Попробуйте записать ещё раз.",
    "No speech was detected. Please record again.",
    "Кеп табылган жок. Кайра жаздырып көрүңүз.",
  ],
  rateLimited: [
    "Слишком много запросов. Попробуйте через минуту.",
    "Too many requests. Please try again in a minute.",
    "Суроолор өтө көп. Бир мүнөттөн кийин кайталаңыз.",
  ],
} as const;
export type BaamCopyKey = keyof typeof copy;
export const baamCopy = (locale: string, key: BaamCopyKey) => {
  const [ru, en, kg] = copy[key];
  return baamText(locale, ru, en, kg);
};
export const baamKnownError = (locale: string, key: string): string | undefined =>
  key in copy ? baamCopy(locale, key as BaamCopyKey) : undefined;
