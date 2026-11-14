# CodeQL: разбор замечаний PR #9 — 15 ноября 2026

Успешный job `codeql` означает выполнение анализа, а не отсутствие его замечаний.
Проверка приложения CodeQL для [PR #9](https://github.com/i-iangurazov/bazaar/pull/9)
на head `32fa17f9654406679f246b92313a1fa414a2a126` сообщила шесть annotations:
один critical и пять high. Анализ merge ref `d168d93e3b732a81b40ee3bf02ef2ed247c45091`,
analysis ID `2168572372`, содержит полные SARIF dataflow paths. Ниже разобраны именно
эти пути. Прочие прежние alerts main не объявляются исправленными.

## Результат разбора

| Alert | Что фактически выполняется | Действие и граница вывода |
| --- | --- | --- |
| [210](https://github.com/i-iangurazov/bazaar/security/code-scanning/210), `js/incomplete-url-substring-sanitization` | В локальном browser QA счётчик запросов использовал `url.includes("api.hiobuy.com")`. Это ошибочно считает совпадение в пути или чужом имени. Отдельный route guard уже запрещает любую внешнюю сеть. | Заменено на `new URL(request.url()).hostname === "api.hiobuy.com"`. Ни вызов провайдера, ни разрешение внешней сети не добавлены. Закрытие этого alert проверяет следующий анализ. |
| [207](https://github.com/i-iangurazov/bazaar/security/code-scanning/207), `js/xss-through-dom`, `china-image-search.tsx` | SARIF source — `event.target.files[0]`, затем **`URL.createObjectURL(file)`**, React state `preview`, статический JSX `<img src={src}>`. Содержимое файла не передаётся в HTML parser или `innerHTML`. | False positive для указанного пути. Blob URL создаёт браузер; файл отображается как ресурс изображения. Дополнительный тест проверяет hostile имя/содержимое файла, blob `src`, отсутствие добавленных script/event attributes. Подготовка/серверная нормализация файлов — отдельная защита, не основание для этой классификации. |
| [208](https://github.com/i-iangurazov/bazaar/security/code-scanning/208), `js/xss-through-dom`, `product-photo-search.tsx`, `<img>` | Тот же source `File` → `URL.createObjectURL` → `Photo` → React `img.src`. Значение файла не является строкой разметки приложения. | False positive для указанного пути. Регрессия проверяет img preview и буквальное отображение hostile имени товара в тексте/`alt`. |
| [209](https://github.com/i-iangurazov/bazaar/security/code-scanning/209), тот же файл, SVG `<image href={preview}>` | Тот же созданный браузером blob URL используется как **внешний ресурс `<image>`**, не как inline SVG-разметка. Рамку рисуют отдельные статические JSX `svg/rect`; координаты не подставляются в HTML. | False positive для указанного пути. Тест после настоящего React перехода в режим рамки проверяет blob `href`, отсутствие injected script/onload/onerror и отображение распознанного текста как текста. JSDOM проверяет построенный DOM, а не выполнение SVG движком браузера; это не новый browser exploit test. |
| [205](https://github.com/i-iangurazov/bazaar/security/code-scanning/205), `js/request-forgery`, `productImageFetch.ts` | Source `request.url` проходит exact origin/path policy в `product-images/source`, затем общий безопасный транспорт. Каждый hop разрешает только HTTP(S) без credentials/нестандартного порта, отвергает локальные имена и любой непубличный DNS answer. Уже проверенный DNS snapshot **закрепляется в custom lookup native HTTP(S)**; `agent:false`, повторной DNS-проверки у соединения нет. IP literals проверяются до соединения. Native HTTP не следует redirect автоматически. | False positive для данного guarded sink по разбору кода и текущим регрессиям. Нового обхода защиты не продемонстрировано. Сохраняются тесты private/mapped/NAT64/IPv6, смешанных DNS answers, rebinding snapshot, redirect-to-private, URL policy на каждом hop, размеров/abort и файлового containment. Это не утверждение об отсутствии любых будущих SSRF; при изменении транспорта/диапазонов нужна новая оценка. |
| [42](https://github.com/i-iangurazov/bazaar/security/code-scanning/42), `js/insufficient-password-hash`, `paymentConfig.ts` | SHA256 от API credential используется только как **детерминированная 128-bit merchant identity**, не как пароль пользователя, login verifier или разрешение платежа. Фактические provider credentials выбираются из server environment по identity, а запросы требуют API secret. | Прежнее baseline false positive классификации пароля, уже разобранное в [ревью 10 ноября](codeql-review-20261110.md). Смена KDF/формата сломает сверку сохранённых invoices и rotation, поэтому формат сохранён. Существующие тесты проверяют стабильность identity, текущие/предыдущие ключи и отказ для чужого identity. |

## Проверки и дальнейшее ревью

Целевой набор: `product-photo-search-ui`, `china-image-search-ui`, `product-image-fetch`,
`product-image-source-route`, `image-export-route`, `gopay-config`. Выполняется через
изолированную unit-среду с отключёнными провайдерами и `RUN_DB_TESTS=0`; реальные ключи,
внешние платежи и клиентские базы не нужны. Тесты добавлены к обычному CI, а не к
отдельному исключающему security scan набору.

Локальный повтор на Node 22.23.4: **6 файлов / 145 тестов прошли**. Два новых теста
покрывают hostile file/имена и оба режима preview; остальных 143 проверки включают
транспорт, managed source/export и детерминированную merchant identity.

CodeQL правила и dataflow paths не отключались, фильтры SARIF не добавлялись,
GitHub alerts не закрывались и не dismiss-ились. Поэтому после исправления QA
оставшиеся пять annotations могут продолжать делать **внешнюю проверку CodeQL красной**,
даже если все jobs CI и production build успешны. Этот факт должен оставаться видимым
в PR и решении о слиянии. Классификация в этой записи — доказательства для ревью,
а не подмена результата GitHub check.
