import type { Locale } from "@/lib/locales";
import type { LegalCopy } from "./types";

type AppleLegalCopy = {
  draft: string;
  published: string;
  draftNotice: string;
  sellerIntro: string;
  document: LegalCopy["documents"]["offer"];
};

// Retain this version's text when introducing a later Apple revision. The URL
// and consent revision are frozen into each newly accepted purchase intent.
export const applePurchaseLegalCopy: Record<Locale, AppleLegalCopy> = {
  ru: {
    draft: "Черновик · тестовая версия",
    published: "Условия покупок Apple · 13 ноября 2026 года",
    draftNotice: "Редакция для проверки в изолированной тестовой версии. Окончательное утверждение владельцем для публичного выпуска ещё требуется. Просмотр текста не включает продажи и не меняет ранее оплаченные покупки.",
    sellerIntro: "Доступ к Bazaar предоставляет указанный ИП. Платежи внутри iOS обрабатывает Apple; банковские реквизиты исполнителя не являются инструкцией оплатить покупку App Store отдельным переводом.",
    document: {
      title: "Условия покупок Bazaar через Apple",
      description: "Дополнение к общей оферте для покупок внутри iOS: срок доступа, цена Apple, организация, повышение тарифа, сообщения и возвраты.",
      sections: [
        { id: "scope", title: "1. Область действия и согласие", paragraphs: [
          "Эта редакция дополняет общую оферту Bazaar только для покупок цифрового доступа и пакетов внутри приложения iOS через App Store. Для такой покупки при различии правил оплаты применяются эти специальные условия и соответствующие условия Apple. Веб-платежи через GoPay в KGS и прежние договоры сохраняют свои условия.",
          "Перед покупкой уполномоченный администратор проверяет организацию, состав предложения, срок, ограничения и окончательную цену, отдельно принимает условия и подтверждает системное окно Apple. Регистрация и обычный вход не разрешают списание. Версия и ссылка принятых условий сохраняются вместе с покупкой; новая редакция не переписывает прежние записи.",
        ] },
        { id: "term", title: "2. Срок без автоматического продления", paragraphs: [
          "Покупка доступа — разовая подписка без автоматического продления (Non-Renewing Subscription) на доступные 1, 6 или 12 календарных месяцев. Для следующего срока требуется отдельное подтверждение новой покупки. Отменять автоматическое продление у такой покупки не требуется.",
          "До оплаты показываются конкретные даты. При досрочном продлении дополнительный срок начинается после уже действующего оплаченного или пробного доступа; при его отсутствии — после подтверждённой покупки. Границы рассчитываются в UTC по календарным месяцам, с последним днём месяца при отсутствии соответствующего числа. Оплата полугода или года не превращает месячные лимиты в единый безусловный расходуемый объём: они обновляются по правилам тарифа.",
        ] },
        { id: "price", title: "3. Цена и подтверждение Apple", paragraphs: [
          "Денежная цена покупки и её валюта берутся из App Store для текущей витрины Apple Account. Окончательная сумма показана перед подтверждением в системном окне Apple. Веб-цена в KGS и справочная стоимость услуги не являются обещанием списать такую же сумму через Apple. Если цена или витрина изменилась, покупку необходимо проверить и подтвердить заново.",
          "Если для формирования цен использован согласованный ориентир комиссии Apple 15%, он не является скидкой 15% покупателю, валютным курсом или гарантией применения Apple именно этой комиссии. Возможную временную разницу комиссии несёт исполнитель; уже подтверждённая цена не дополняется отдельным требованием доплаты. Условия конвертации и расчётов платёжного средства определяются Apple и банком покупателя.",
        ] },
        { id: "organization", title: "4. Общий доступ организации без повторной оплаты", paragraphs: [
          "Права относятся к выбранной организации Bazaar и действуют в веб-версии и iOS в пределах тарифа и полномочий сотрудников. Уже подтверждённый оплаченный период, включая GoPay, сохраняется: установка или вход в iOS не требуют повторно оплачивать тот же доступ через Apple. Сознательное досрочное продление покупает дополнительный следующий срок, а не повторно текущий.",
          "Покупка связывается с организацией при подтверждении. Вход в другую организацию или другой аккаунт не переносит туда покупку. Проверка результата и восстановление не являются новой оплатой. Если Apple уже подтвердила покупку, а Bazaar ещё проверяет результат, используйте проверку покупок или поддержку и не оплачивайте повторно.",
        ] },
        { id: "upgrade", title: "5. Повышение только на остаток срока", paragraphs: [
          "Когда повышение доступно для действующего периода, оплаченного GoPay или разовой подпиской Apple, рассчитывается доплата за оставшийся срок. Выбирается наименьшая доступная одобренная цена Apple, которая покрывает расчётную доплату. Поэтому фактический платёж может быть выше расчётной суммы; для любой положительной доплаты применяется доступный минимум Apple. До подтверждения видны выбранная цена и изменение прав. Нулевая доплата не превращается в платёж.",
          "Дата окончания базового периода и заранее оплаченные будущие периоды сохраняются. Разница округления не создаёт кошелёк, денежный остаток, дополнительные месяцы или дополнительные лимиты. Использованные и зарезервированные месячные объёмы не обнуляются. Если подходящей цены нет, покупка повышения не проводится. Понижение тарифа не снимает уже оплаченные права задним числом.",
        ] },
        { id: "messages", title: "6. Пакеты сообщений Apple", paragraphs: [
          "Пакеты сообщений, приобретённые через Apple, учитываются отдельно от веб-пакетов: их неиспользованные единицы не имеют календарного срока сгорания и остаются до использования. Количество и цена показываются перед покупкой. Это не денежный баланс и не основание вывести остаток наличными; обязательные права на возврат сохраняются.",
          "Расходование требует доступной интеграции и соответствующих прав организации. Покупка пакета сама по себе не подключает внешний сервис и не гарантирует отправку любого сообщения. Старые и новые веб-пакеты сохраняют собственные сроки и условия. Подтверждённый возврат конкретной покупки Apple может отменить права по этой покупке; другие независимые покупки не переписываются.",
        ] },
        { id: "restore", title: "7. Проверка и восстановление", paragraphs: [
          "Для проверки войдите в исходную организацию Bazaar с правом управления подпиской и используйте Apple Account, с которого сделана покупка. Восстановление сверяет подтверждённые операции с серверным учётом: оно не создаёт повторный период, не продлевает старую дату окончания и не возвращает уже израсходованные единицы сообщений. Если операция не найдена, сохраните подтверждение Apple и обратитесь в поддержку.",
          "Ранее предоставленный доступ и прежние принятые условия не требуют повторного согласия только из-за этой новой редакции. Исторические суммы, поставщик оплаты, даты и принадлежность организации сохраняются. Неподтверждённые, спорные и возвращённые операции проверяются отдельно; сообщение браузера или скриншот сами по себе не устанавливают успешную оплату.",
        ] },
        { id: "refunds", title: "8. Возвраты и обязательные права", paragraphs: [
          "Возврат покупки App Store запрашивается через доступную функцию возврата Apple, reportaproblem.apple.com или Apple Support. Apple рассматривает обращение и проводит одобренный возврат по своим правилам; исполнитель не обещает решение или банковский срок от имени Apple. Сроки отдельного банковского возврата GoPay к такой покупке не применяются. По непредоставленному доступу также можно обратиться в поддержку Bazaar.",
          "После проверенного уведомления о возврате права по соответствующей покупке могут быть отменены. Возврат повышения затрагивает это повышение; отмена базового оплаченного периода может приостановить зависящие от него повышения. Независимые периоды и их история сохраняются. Передача Apple сведений об использовании для рассмотрения возврата требует отдельного добровольного согласия; отказ или отзыв не блокируют обращение за возвратом или оплаченный доступ. Обязательные права по применимому законодательству сохраняются.",
        ] },
      ],
    },
  },
  en: {
    draft: "Draft · test version",
    published: "Apple purchase terms · 13 November 2026",
    draftNotice: "For review in the isolated test version. Final owner approval for public release is still required. Viewing this text neither enables sales nor changes previously paid purchases.",
    sellerIntro: "The named entrepreneur provides Bazaar access. Apple processes in-app iOS payments; the provider's bank details are not instructions to pay separately for an App Store purchase.",
    document: {
      title: "Terms for Bazaar purchases through Apple",
      description: "Supplement for iOS purchases: access periods, Apple prices, organisations, current-term upgrades, messages and refunds.",
      sections: [
        { id: "scope", title: "1. Scope and acceptance", paragraphs: [
          "This edition supplements the general Bazaar offer only for digital access and packs purchased inside the iOS app through the App Store. These specific payment terms and the applicable Apple terms govern that purchase where payment rules differ. GoPay web payments in KGS and existing agreements retain their own terms.",
          "Before buying, an authorised administrator checks the organisation, offer, period, limits and final price, expressly accepts the terms and confirms Apple's system sheet. Registration or signing in does not authorise a charge. The accepted version and URL are retained with the purchase; later editions do not rewrite earlier records.",
        ] },
        { id: "term", title: "2. A fixed period without auto-renewal", paragraphs: [
          "Access is a one-off Non-Renewing Subscription for an available 1, 6 or 12 calendar months. Another term requires a separately confirmed purchase. There is no automatic renewal to cancel for this product.",
          "Exact dates appear before purchase. Early renewal starts the additional term after existing paid or trial access; otherwise it starts after verified payment. UTC calendar-month boundaries use the month's last day if the corresponding day does not exist. Six- or twelve-month prepayment retains the plan's monthly allowance resets rather than creating one unrestricted allowance.",
        ] },
        { id: "price", title: "3. Apple price and confirmation", paragraphs: [
          "The monetary price and currency come from the App Store for the current Apple Account storefront. Apple's confirmation sheet shows the final charge. A web KGS price or service valuation does not promise the same charge through Apple. A changed price or storefront requires checking and confirming the purchase again.",
          "An agreed 15% Apple commission reference used to form prices is not a customer discount, an exchange rate or a guarantee of Apple's actual commission. The provider bears any temporary commission difference without adding a further charge to an already confirmed price. Apple and the payer's bank determine payment-method conversion and settlement terms.",
        ] },
        { id: "organization", title: "4. Shared organisation access without paying twice", paragraphs: [
          "Access belongs to the selected Bazaar organisation across web and iOS, within its plan and staff permissions. Existing verified paid coverage, including GoPay, remains valid: installing or signing in to iOS does not require buying that access again through Apple. An intentional early renewal buys an additional future term.",
          "A purchase is bound to its selected organisation. Signing in elsewhere does not transfer it. Checking or restoring a purchase is not another payment. If Apple confirmed a purchase while Bazaar is still checking it, use purchase verification or support instead of paying again.",
        ] },
        { id: "upgrade", title: "5. Upgrades for the remaining current term", paragraphs: [
          "An available upgrade of a current GoPay-funded or Apple non-renewing period uses the remaining-term additional service value. The lowest available approved Apple price covering that amount is selected. The charge may therefore exceed the calculated value; Apple's available minimum applies to a positive amount. The price and changed rights appear before confirmation. A zero amount is not turned into a charge.",
          "The base expiry and prepaid future periods remain unchanged. Rounding does not create a wallet, cash balance, extra months or extra capacity. Used and reserved monthly allowances do not reset. If no eligible price covers the amount, no upgrade purchase proceeds. A downgrade does not retrospectively remove paid rights.",
        ] },
        { id: "messages", title: "6. Apple message packs", paragraphs: [
          "Message packs bought through Apple are recorded separately from web packs: unused Apple units have no calendar expiry and remain until used. Quantity and price appear before purchase. They are not money or a withdrawable balance; mandatory refund rights remain.",
          "Use requires an available integration and the organisation's permissions. Buying a pack does not connect an external service or guarantee every message can be sent. Existing and new web packs retain their own expiry rules. A verified refund may remove rights from its particular Apple purchase without rewriting independent purchases.",
        ] },
        { id: "restore", title: "7. Checking and restoring", paragraphs: [
          "Sign in to the original Bazaar organisation with subscription-management rights and use the purchasing Apple Account. Restoration checks verified transactions against the server ledger. It does not create another period, extend the old expiry or replenish used message units. If a transaction is missing, retain Apple's confirmation and contact support.",
          "Previously granted access does not require reacceptance merely because this edition is new. Earlier amounts, payment providers, dates and organisation bindings remain intact. Unverified, disputed and refunded transactions are checked separately; a browser message or screenshot alone does not establish payment success.",
        ] },
        { id: "refunds", title: "8. Refunds and mandatory rights", paragraphs: [
          "Request an App Store refund using Apple's available refund function, reportaproblem.apple.com or Apple Support. Apple reviews requests and processes approved refunds under its rules; the provider does not promise Apple's decision or bank timeline. GoPay bank-transfer refund timelines do not apply. Bazaar support can also help with missing access.",
          "Verified refund information may remove the corresponding purchase rights. Refunding an upgrade affects that increment; revoking its paid base may suspend dependent upgrades. Independent periods and history remain. Sharing usage information with Apple for refund review requires separate voluntary consent; refusing or withdrawing it does not block a refund request or paid access. Mandatory rights under applicable law are preserved.",
        ] },
      ],
    },
  },
  kg: {
    draft: "Долбоор · сыноо версиясы",
    published: "Apple сатып алууларынын шарттары · 2026-жылдын 13-ноябры",
    draftNotice: "Обочолонгон сыноо версиясында текшерүү үчүн редакция. Жалпыга чыгаруу үчүн ээсинин акыркы бекитүүсү дагы талап кылынат. Текстти көрүү сатууну иштетпейт жана мурда төлөнгөн сатып алууларды өзгөртпөйт.",
    sellerIntro: "Bazaar жетүүсүн көрсөтүлгөн ЖИ берет. iOS ичиндеги төлөмдөрдү Apple иштетет; аткаруучунун банк реквизиттери App Store сатып алуусун өзүнчө которуу менен төлөө көрсөтмөсү эмес.",
    document: {
      title: "Bazaar кызматын Apple аркылуу сатып алуунун шарттары",
      description: "iOS сатып алууларына кошумча шарттар: жетүү мөөнөтү, Apple баасы, уюм, учурдагы тарифти жакшыртуу, билдирүүлөр жана кайтаруулар.",
      sections: [
        { id: "scope", title: "1. Колдонуу чөйрөсү жана макулдук", paragraphs: [
          "Бул редакция App Store аркылуу iOS колдонмосунун ичинде алынган санарип жетүүгө жана пакеттерге гана Bazaar жалпы офертасын толуктайт. Төлөм эрежелери айырмаланса, ушул атайын шарттар жана Apple тиешелүү шарттары колдонулат. GoPay аркылуу KGS менен веб-төлөмдөр жана мурдагы келишимдер өз шарттарын сактайт.",
          "Сатып алуудан мурун ыйгарым укуктуу администратор уюмду, сунушту, мөөнөттү, чектөөлөрдү жана акыркы бааны текшерип, шарттарга өзүнчө макул болуп, Apple системалык терезесин ырастайт. Катталуу же кирүү акча алууга уруксат бербейт. Кабыл алынган редакция жана шилтеме сатып алуу менен сакталат; кийинки редакция мурдагы жазууларды өзгөртпөйт.",
        ] },
        { id: "term", title: "2. Автоматтык узартылбаган мөөнөт", paragraphs: [
          "Жетүү — жеткиликтүү 1, 6 же 12 календардык айга бир жолку, автоматтык узартылбаган жазылуу (Non-Renewing Subscription). Кийинки мөөнөт үчүн жаңы сатып алууну өзүнчө ырастоо керек. Бул сатып алууда автоматтык узартууну өчүрүү талап кылынбайт.",
          "Так күндөр төлөмгө чейин көрсөтүлөт. Эрте узартууда кошумча мөөнөт учурдагы төлөнгөн же сыноо жетүүсүнөн кийин, ал жок болсо ырасталган сатып алуудан кийин башталат. Чектер UTC боюнча календардык айлар менен эсептелет; тиешелүү күн жок болсо айдын акыркы күнү алынат. Жарым жылдык же жылдык төлөм тарифтин ай сайын жаңылануучу көлөмдөрүн чектөөсүз бир жалпы көлөмгө айлантпайт.",
        ] },
        { id: "price", title: "3. Apple баасы жана ырастоо", paragraphs: [
          "Сатып алуунун акчалай баасы жана валютасы Apple Account учурдагы витринасы үчүн App Store маалыматынан алынат. Акыркы сумма Apple системалык ырастоо терезесинде көрсөтүлөт. KGS менен веб-баа же кызматтын эсептик наркы Apple аркылуу ошол эле сумманы алуу убадасы эмес. Баа же витрина өзгөрсө, сатып алууну кайра текшерип ырастоо керек.",
          "Бааларды түзүүдө колдонулган макулдашылган 15% Apple комиссиясынын багыты кардарга 15% арзандатуу, валюта курсу же Apple сөзсүз ушул комиссияны алат деген кепилдик эмес. Комиссиянын убактылуу айырмасын аткаруучу көтөрөт; ырасталган баага кийин кошумча төлөм талап кылынбайт. Төлөө каражатынын конвертациясын жана эсептешүү шарттарын Apple жана төлөөчүнүн банкы аныктайт.",
        ] },
        { id: "organization", title: "4. Уюмдун жалпы жетүүсү жана кайталанбаган төлөм", paragraphs: [
          "Укуктар тандалган Bazaar уюмуна тиешелүү болуп, тариф жана кызматкердин ыйгарым укуктарынын чегинде вебде жана iOSто иштейт. GoPay менен төлөнгөн мөөнөт да сакталат: iOS орнотуу же ага кирүү ошол эле жетүү үчүн Apple аркылуу кайра төлөөнү талап кылбайт. Атайын эрте узартуу учурдагы мөөнөттү кайра эмес, кийинки кошумча мөөнөттү сатып алат.",
          "Сатып алуу ырасталганда тандалган уюмга бекитилет. Башка уюмга же аккаунтка кирүү сатып алууну ал жакка өткөрбөйт. Натыйжаны текшерүү жана калыбына келтирүү жаңы төлөм эмес. Apple сатып алууну ырастап, Bazaar дагы текшерип жатса, кайра төлөбөстөн сатып алууларды текшериңиз же колдоого кайрылыңыз.",
        ] },
        { id: "upgrade", title: "5. Учурдагы мөөнөттүн калдыгына гана жакшыртуу", paragraphs: [
          "GoPay же Apple бир жолку жазылуусу менен төлөнгөн учурдагы мезгилди жакшыртуу жеткиликтүү болсо, калган мөөнөт үчүн кошумча нарк эсептелет. Аны жаба алган эң төмөнкү жеткиликтүү бекитилген Apple баасы тандалат. Ошондуктан чыныгы төлөм эсептик нарктан жогору болушу мүмкүн; оң сумма үчүн Apple жеткиликтүү минималдуу төлөмү колдонулат. Баа жана укуктардын өзгөрүшү ырастоого чейин көрсөтүлөт. Нөл сумма төлөмгө айлантылбайт.",
          "Базалык мөөнөттүн аягы жана алдын ала төлөнгөн келечектеги мезгилдер сакталат. Тегеректөө айырмасы капчык, акчалай калдык, кошумча айлар же лимиттерди түзбөйт. Колдонулган жана резервделген айлык көлөмдөр нөлдөн башталбайт. Ылайыктуу баа жок болсо жакшыртуу сатып алынбайт. Тарифти төмөндөтүү мурда төлөнгөн укуктарды артка карай алып салбайт.",
        ] },
        { id: "messages", title: "6. Apple билдирүү пакеттери", paragraphs: [
          "Apple аркылуу алынган билдирүү пакеттери веб-пакеттерден өзүнчө эсептелет: пайдаланылбаган Apple бирдиктеринин календардык күйүп кетүү мөөнөтү жок, алар колдонулганга чейин сакталат. Сан жана баа сатып алууга чейин көрсөтүлөт. Бул акча же накталай чыгарып алууга боло турган калдык эмес; милдеттүү кайтаруу укуктары сакталат.",
          "Колдонуу үчүн жеткиликтүү интеграция жана уюмдун тиешелүү укуктары керек. Пакетти сатып алуу тышкы кызматты өзү кошпойт жана ар бир билдирүү сөзсүз жөнөтүлөт деп кепилдик бербейт. Мурдагы жана жаңы веб-пакеттер өз мөөнөттөрүн сактайт. Apple белгилүү сатып алууну ырастап кайтарса, ошол сатып алуунун укуктары жокко чыгарылышы мүмкүн; башка өз алдынча сатып алуулар өзгөртүлбөйт.",
        ] },
        { id: "restore", title: "7. Текшерүү жана калыбына келтирүү", paragraphs: [
          "Текшерүү үчүн баштапкы Bazaar уюмуна жазылууну башкаруу укугу менен кирип, сатып алган Apple Account колдонуңуз. Калыбына келтирүү ырасталган операцияларды сервердик эсеп менен салыштырат. Ал жаңы мезгил түзбөйт, мурдагы аяктоо күнүн узартпайт жана колдонулган билдирүү бирдиктерин толуктабайт. Операция табылбаса Apple ырастоосун сактап, колдоого кайрылыңыз.",
          "Ушул жаңы редакциянын өзү мурда берилген жетүүгө кайра макулдук берүүнү талап кылбайт. Мурдагы суммалар, төлөм провайдери, даталар жана уюмга тиешелүүлүк сакталат. Ырасталбаган, талаштуу жана кайтарылган операциялар өзүнчө текшерилет; браузер билдирүүсү же сүрөт жалгыз өзү ийгиликтүү төлөмдү аныктабайт.",
        ] },
        { id: "refunds", title: "8. Кайтаруулар жана милдеттүү укуктар", paragraphs: [
          "App Store сатып алуусун кайтаруу Apple жеткиликтүү кайтаруу функциясы, reportaproblem.apple.com же Apple Support аркылуу суралат. Apple кайрылууну өз эрежелери боюнча карап, жактырылган кайтарууну жүргүзөт; аткаруучу Apple чечимин же банктын мөөнөтүн убада кылбайт. GoPay банктык кайтаруу мөөнөттөрү бул сатып алууга колдонулбайт. Жетүү берилбесе Bazaar колдоосуна да кайрылууга болот.",
          "Кайтаруу жөнүндө текшерилген маалыматтан кийин тиешелүү сатып алуунун укуктары токтотулушу мүмкүн. Жакшыртууну кайтаруу ошол жакшыртууга тиешелүү; төлөнгөн базаны жокко чыгаруу ага көз каранды жакшыртууларды токтото алат. Өз алдынча мезгилдер жана тарых сакталат. Кайтарууну кароо үчүн Apple компаниясына колдонуу маалыматын берүү өзүнчө ыктыярдуу макулдукту талап кылат; баш тартуу же кайра чакыртуу кайтаруу суроосун же төлөнгөн жетүүнү бөгөттөбөйт. Колдонулуучу мыйзамдагы милдеттүү укуктар сакталат.",
        ] },
      ],
    },
  },
};
