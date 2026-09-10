# Авторизованный интерфейс Bazaar · сентябрь 2026

Область выпуска — авторизованные страницы и общие UI-компоненты. Исходный main: `7e044f726e19ad835faed03262b1226361cb1178`. Репозиторий был чистым; работа ведётся непосредственно в main. Складские и финансовые сервисы, разрешения, нулевая себестоимость, интеграции и схема БД не изменяются.

## Направление

Рабочая система с фирменным синим акцентом: спокойный фон, непрозрачные поверхности, компактные строки, ясные названия и один уровень основных действий. Цвет обозначает действие или статус; статусы сохраняют текст. На телефоне второстепенные настройки вида раскрываются по запросу. Общие компоненты сохраняют существующие Radix-механизмы фокуса и порталов.

## Рабочая матрица

| Экран / компонент | Подтверждённая проблема | Решение и сценарии | Проверка / результат |
| --- | --- | --- | --- |
| Главная панель | Шесть KPI распадались на 5+1; отсутствующая база сравнения выглядела положительной; нулевая выручка имела искусственную высоту графика | Четыре фактических KPI, магазин, дата и часовой пояс; отдельные loading/error/zero; нулевые столбцы; переходы в отчёты и требующие внимания списки с магазином и условием | Bootstrap API и браузер: 217 KGS, один чек; переход к товарам без цены; пустые и ошибочные состояния; container queries для узкой рабочей области |
| Товары | URL `query` игнорировался; readiness нельзя было сбросить; поиск терялся при возврате | Единая панель, активные условия, канонический URL, возврат в ту же вкладку и список; компактные изображения и строки | Поиск → reload → редактирование → Back; пустой результат → сброс; страница 2 → reload |
| Запасы | Разные мобильные/десктопные фильтры; смесь общего числа записей и статистики одной страницы | Общий поиск/магазин/остаток, дополнительные параметры; явно подписанная статистика текущей страницы | Прямой URL отрицательных остатков, сравнение строки/сводки/API; 360/390/768/1440 |
| Товары, запасы, поставки: выбор | Выбор всех товаров не учитывал readiness; поздний ответ мог вернуть скрытый выбор | Одинаковый набор фильтров для list/listIds; подпись области выбора; сброс при изменении условий; проверка принадлежности асинхронного ответа текущему поиску | Браузер: один товар на странице → все отфильтрованные; задержка listIds + смена поиска; никаких скрытых записей |
| Быстрое редактирование | Ячейка доступна только мышью | Enter/F2 с клавиатуры при тех же правах, возврат фокуса; видимая подсказка; прежний серверный процесс и абсолютная семантика количества | Двойной клик, 0, Enter+blur, Escape; ADMIN и MANAGER одновременно, HTTP 409; сеть/повтор; запрещённые роли |
| Клиенты, поставщики | Дублирующиеся панели на телефоне, разрозненные поиски | Общий ListToolbar, активные фильтры и понятное пустое состояние; клиентская смена URL без серверной навигации на каждую букву | Браузер всех разрешённых ролей, мобильные размеры; source/regression-тесты |
| Поставки, заказы | Контекст магазина терялся при создании документа; мобильный фильтр имитировал модальный без управления фокусом | Доступный магазин из URL, returnTo в созданном документе и хлебных крошках; общие фильтры, настоящая клавиатурная навигация tabs | Создание/карточка/возврат; доступность Select; браузер страниц и форм |
| POS | Контекст магазина из панели не учитывался; недоступная ссылка выглядела выключенной, но оставалась ссылкой | Фильтрация доступных касс по магазину; защита от устаревшей смены в UI; выключенная продажа — button; единый main | Браузер другого магазина без кассы; штатная продажа в изолированном магазине; проверки ролей и BAAM |
| Движения | Слишком широкая сетка фильтров; скрытые подписи действий растягивали document, несмотря на прокрутку таблицы | Адаптивная сетка; positioned scrolling container для DataTable/TableContainer | Измерение scrollWidth, DOM-диагностика: позиционирование контейнера возвращает ширину 1563 → 1440; повторный полный capture |
| Карточка товара | Отдельные жёстко заданные серые поверхности; полоса сохранения конфликтовала с плавающими элементами | Общие токены обеих тем, нормальные поля/подписи, непрозрачное сохранение, obstacle для BAAM; улучшенные EN-подписи | Создание через форму с обрывом сети и повтором; форма сохраняет значения; создан ровно один товар в нужном магазине |
| Оприходование / перемещение | Несвязанные подписи; оприходование игнорировало обычный storeId в URL; недоступный магазин мог заменяться первым | Явные htmlFor/id/aria-label; доступный магазин из URL, без молчаливой подстановки при неверном ID; больше места заголовкам количеств | Обычный UI и серверные значения двух магазинов; нулевая себестоимость остаётся разрешённой |
| Select / FormControl | Radix Root не имеет DOM: терялись id, описание, ошибка и ref фокуса | Контекст переносит атрибуты и ref на Trigger, поддерживая обе существующие структуры форм | DOM unit-тест label/helper/aria-invalid/ref и браузер форм/настроек/отчётов |
| Button / RowActions | disabled у ссылки не блокировал активацию; редактирование открывалось в новой вкладке | aria-disabled, запрет активации и tabIndex; обычное редактирование в текущей вкладке, явные отдельные печатные окна сохранены | Unit: click/Enter не вызывают действие; печать остаётся отдельной; edit + Back в браузере |
| DataTable / ResponsiveDataList | Пагинация исчезала для одной страницы; размер страницы нельзя было изменить | Постоянная сводка и доступная подпись размера; сохранение допустимого нестандартного размера из URL | Unit: одна запись, отключённые стрелки, доступный Select; браузер pageSize=1 и пагинация |
| AppShell / PageHeader / Card | Декоративные рамки создавали лишние уровни; мобильная шапка показывала первый магазин независимо от данных | Общее рабочее пространство и иерархия; реальный магазин у данных; overflow-x: clip сохраняет sticky-шапку при прокрутке; skip link; единый заголовок; компактные поверхности | Все статические страницы, четыре роли; POS, формы, меню, BAAM и адаптивные размеры |
| BAAM | Плавающая кнопка перекрывала завершение продажи и проведение документа; учитывались только fixed-панели | На телефоне одна кнопка встроена в шапку; установка приложения остаётся в меню. На POS и десктопе учитываются явно отмеченные основные действия и submit-кнопки; пересчёт при прокрутке, изменении размеров и появлении действий; таблицы не влияют на положение | Геометрические unit-тесты, сохранены прежние проверки; браузер измеряет отсутствие пересечения с оприходованием и оплатой; мобильные меню и чат |
| Форматы дат KG | Chromium без ky-KG незаметно показывал английские названия месяцев | Числовая дата и время при отсутствии локали; сохранены часовой пояс и нативные RU/EN/KG форматы | Три регрессионных теста и KG-снимки |
| Настройки, отчёты, цеха и интеграции | Общие таблицы/формы имели те же проблемы доступности и визуальной иерархии | Изменения через общие компоненты, без изменения бизнес-процессов | Каталог маршрутов ниже; отдельные подписи полей экспорта и закрытия периода; все десять динамических шаблонов проверены с изолированными сущностями |

## Воспроизведение

`pnpm test:ux` применяет штатные миграции к **пустой локальной** `bazaar_hardening_ux`, создаёт синтетические товары, магазины и четыре роли, запускает браузер и сохраняет `artifacts/ux/flows` и `artifacts/ux/after`. Скрипты не принимают production URL. AI/email/payment/storage credentials очищаются; внешние эффекты отключены; браузер блокирует сторонние запросы. Повторный seed в непустую БД намеренно запрещён.

Для локальной проверки production-пакета: `scripts/ux/build.ts`, затем `UX_HTTPS=1 node --import tsx scripts/ux/dev.ts --production`, `scripts/ux/browser.ts` и `scripts/ux/capture.ts` с `UX_HTTPS=1`. HTTPS использует локальный тестовый сертификат. Нельзя запускать build и сервер одновременно над одним `.next`.

Полные DB-тесты используют отдельную предусмотренную allowlist БД `bazaar_hardening_ci`, а не данные браузерных сценариев. CI добавляет обязательный `ux-browser` в release-gate; существующие security, stock, BAAM, landing, печать и stabilization-проверки сохранены.

Скриншоты до изменения: `artifacts/ux/before` (51 наблюдение). Файлы baseline с пометкой dark не являются доказательством тёмной темы: session preference могла заменить cookie. После изменения тема переключается штатным интерфейсом, проверяется class на HTML; язык переключается кнопкой и проверяется HTML lang. Изменения предпочтений затрагивают только тестового пользователя.

Проверка 200% использует CSS zoom как дополнительный стресс-тест; это не физический телефон и не проверка системного масштаба браузера. Ширины 360/390/768/1440 — эмуляция Chromium. Проверены все статические страницы и десять динамических шаблонов с созданными штатными сервисами тестовыми документами. Физические устройства и экранные дикторы не заявляются проверенными.

Production smoke требует точный `--sha`, проверяет `/api/version` до и после, создаёт отдельную INTERNAL QA организацию со случайными паролями, использует реальные формы и чтения. Продаж, оплат, фискализации, рассылок и AI-запросов production smoke не выполняет. В конце все тестовые пользователи деактивируются с отзывом сессий; QA-история сохраняется.

## Локальная проверка выпуска

- `pnpm test:ci`: **1987 тестов, 285 файлов**, typecheck, lint и i18n — успешно. Прежние проверки сохранены; добавлен тест единственного экземпляра BAAM при смене ширины.
- Production build — успешно; на собранном HTTPS-пакете повторены **20 сквозных браузерных сценариев**. Проверены реальные ответы и записи штатных сервисов, а не только видимый текст об успехе.
- Печатная регрессия: **20 PDF, 60 страниц**, проверка геометрии и текста — успешно. Физический принтер не использовался.
- Дополнительно: три теста кыргызского формата даты при отсутствии ky-KG в ICU браузера; поддерживающие браузеры сохраняют локализованные месяцы, остальные используют числовую дату в часовом поясе Бишкека.
- Финальная визуальная матрица: **187 состояний**, четыре роли, RU/KG/EN, обе темы и 360/390/768/1440 px; ноль ошибок JavaScript/переводов и горизонтального переполнения страницы. Все десять динамических шаблонов открыты с изолированными документами.
- Финальные снимки и размеры: `artifacts/ux/after/report.json`; результаты пользовательских сценариев — `artifacts/ux/flows/report.json`. Все данные этих снимков синтетические.
- GitHub CI и production проверяются для отправленного SHA; точные адреса и результат внешнего выпуска приводятся в отчёте к выпуску, а не подменяются локальной сборкой.

### Проверка после первого запуска CI

Складской браузер воспроизвёл потерю поиска после обновления другой вкладки. Причина: переданный обратно `history.state` содержал служебный `__NA`, из-за чего Next.js пропускал синхронизацию своего адреса. Native History теперь вызывает штатное копирование состояния и обновление `useSearchParams`; исправление применяется к товарам, запасам, клиентам и обоим спискам заказов. Проверяется актуальный `returnTo` до перезагрузки и немедленный серверный поиск в трёх списках. Полный складской сценарий после исправления прошёл дважды.

Регрессионный тест также подтвердил застревание серверной сортировки после перехода в убывание. Для серверных таблиц сохраняется обязательный порядок и повторное переключение asc/desc. Проверяются товары и журнал движений; unit-тест падает до исправления и проходит после.

Новый UI job останавливался после успешного seed: соединение Redis, открытое штатными складскими событиями, удерживало процесс. Seed и дополнительные фикстуры закрывают соединение после записи; проверки и их ограничения не ослаблены.

## Реестр маршрутов и использований

Полный воспроизводимый список прямых импортов каждого изменённого общего компонента: `node --import tsx scripts/ux/component-usage.ts`, результат `artifacts/ux/component-usage.json`. Он включает также публичные страницы и внутренние обёртки Button, Card, Input, Form и других примитивов. Реестр ниже выделяет основные группы и маршруты. Наличие в реестре не означает выполнение всех бизнес-операций на каждой странице; конкретные изменённые сценарии перечислены в матрице и отчёте браузера.

| Route | Shared UI | Browser coverage |
| --- | --- | --- |
| `/admin/jobs` | PageHeader, Card, Table, ResponsiveDataList, Modal | ADMIN capture; existing role redirects recorded |
| `/admin/metrics` | PageHeader, Card, Table, Select | ADMIN capture; existing role redirects recorded |
| `/admin/support` | PageHeader, Card, Select | ADMIN capture; existing role redirects recorded |
| `/baam` | PageHeader | ADMIN capture; existing role redirects recorded |
| `/billing` | PageHeader, Card, Table, Modal | ADMIN capture; existing role redirects recorded |
| `/cash` | AppShell / composed workflow | ADMIN capture; existing role redirects recorded |
| `/customers/new` | AppShell / composed workflow | ADMIN capture; existing role redirects recorded |
| `/customers` | PageHeader, Card, Table, ResponsiveDataList, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/dashboard` | PageHeader, Card, Select | ADMIN capture; existing role redirects recorded |
| `/dev/scanner-test` | AppShell / composed workflow | Development-only, not a production scenario |
| `/finance/expense` | AppShell / composed workflow | ADMIN capture; existing role redirects recorded |
| `/finance/income` | AppShell / composed workflow | ADMIN capture; existing role redirects recorded |
| `/help/compliance` | PageHeader, Card | ADMIN capture; existing role redirects recorded |
| `/inventory/counts/[id]` | PageHeader, Card, Table, ResponsiveDataList, Select, Modal | Isolated entity capture at 1440 and 390; normal domain-service fixture |
| `/inventory/counts/new` | AppShell / composed workflow | ADMIN capture; existing role redirects recorded |
| `/inventory/counts` | PageHeader, Card, Table, ResponsiveDataList, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/inventory/movements/[id]` | PageHeader, Card, Table, ResponsiveDataList | Isolated entity capture at 1440 and 390; normal domain-service fixture |
| `/inventory/movements` | PageHeader, Card, DataTable, ResponsiveDataList, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/inventory` | PageHeader, Card, Table, ResponsiveDataList, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/inventory/receiving/[id]/edit` | AppShell / composed workflow | Isolated entity capture at 1440 and 390; normal domain-service fixture |
| `/inventory/receiving` | AppShell / composed workflow | ADMIN capture; existing role redirects recorded |
| `/inventory/transfers/[id]/edit` | AppShell / composed workflow | Isolated entity capture at 1440 and 390; normal domain-service fixture |
| `/inventory/transfers` | AppShell / composed workflow | ADMIN capture; existing role redirects recorded |
| `/inventory/write-offs/[id]/edit` | AppShell / composed workflow | Isolated entity capture at 1440 and 390; normal domain-service fixture |
| `/inventory/write-offs` | AppShell / composed workflow | ADMIN capture; existing role redirects recorded |
| `/onboarding` | PageHeader, Card, Select | ADMIN capture; existing role redirects recorded |
| `/operations/integrations/bakai-store` | PageHeader, Card, Table, ResponsiveDataList, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/operations/integrations/bazaar-api` | PageHeader, Card, Table, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/operations/integrations/bazaar-catalog` | PageHeader, Card, Table, ResponsiveDataList, Select | ADMIN capture; existing role redirects recorded |
| `/operations/integrations/email-marketing` | AppShell / composed workflow | ADMIN capture; existing role redirects recorded |
| `/operations/integrations/m-market` | PageHeader, Card, Table, ResponsiveDataList, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/operations/integrations/o-market` | PageHeader, Card, Table, Select | ADMIN capture; existing role redirects recorded |
| `/operations/integrations` | PageHeader, Card | ADMIN capture; existing role redirects recorded |
| `/operations/integrations/product-image-studio` | PageHeader, Card, Table, Select | ADMIN capture; existing role redirects recorded |
| `/orders` | AppShell / composed workflow | ADMIN capture; existing role redirects recorded |
| `/platform` | PageHeader, Card, Table, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/pos/debts` | PageHeader, Card, Table, Select | ADMIN capture; existing role redirects recorded |
| `/pos/history` | PageHeader, Card, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/pos/kkm` | PageHeader, Card, Select | ADMIN capture; existing role redirects recorded |
| `/pos` | PageHeader, Card, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/pos/receipts` | AppShell / composed workflow | ADMIN capture; existing role redirects recorded |
| `/pos/registers` | PageHeader, Card, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/pos/sell` | Table, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/pos/shifts` | PageHeader, Card, Select | ADMIN capture; existing role redirects recorded |
| `/products/[id]` | PageHeader, Card, Table, ResponsiveDataList, Select, Modal, ProductForm | Isolated entity capture at 1440 and 390; normal domain-service fixture |
| `/products/new` | PageHeader, Select, ProductForm | ADMIN capture; existing role redirects recorded |
| `/products` | PageHeader, Card, DataTable, ResponsiveDataList, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/purchase-orders/[id]` | PageHeader, Card, Table, ResponsiveDataList, Select, Modal | Isolated entity capture at 1440 and 390; normal domain-service fixture |
| `/purchase-orders/new` | PageHeader, Card, Table, ResponsiveDataList, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/purchase-orders` | PageHeader, Card, Table, ResponsiveDataList, Select | ADMIN capture; existing role redirects recorded |
| `/reports/analytics` | PageHeader, Card, Table, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/reports/close` | PageHeader, Card, Table, ResponsiveDataList, Select | ADMIN capture; existing role redirects recorded |
| `/reports/exports` | PageHeader, Card, Table, ResponsiveDataList, Select | ADMIN capture; existing role redirects recorded |
| `/reports` | PageHeader, Card, Table, ResponsiveDataList, Select | ADMIN capture; existing role redirects recorded |
| `/reports/receipts` | AppShell / composed workflow | ADMIN capture; existing role redirects recorded |
| `/sales/orders/[id]` | PageHeader, Card, Table, Select, Modal | Isolated entity capture at 1440 and 390; normal domain-service fixture |
| `/sales/orders/metrics` | PageHeader, Card, Table, Select | ADMIN capture; existing role redirects recorded |
| `/sales/orders/new` | PageHeader, Card, Select | ADMIN capture; existing role redirects recorded |
| `/sales/orders` | PageHeader, Card, Table, ResponsiveDataList, Select | ADMIN capture; existing role redirects recorded |
| `/settings/attributes` | PageHeader, Card, Table, ResponsiveDataList, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/settings/categories` | PageHeader, Card, Select | ADMIN capture; existing role redirects recorded |
| `/settings/diagnostics` | PageHeader, Card | ADMIN capture; existing role redirects recorded |
| `/settings/import` | PageHeader, Card, Table, ResponsiveDataList, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/settings/printing` | PageHeader, Card, Select | ADMIN capture; existing role redirects recorded |
| `/settings/profile` | PageHeader, Card, Select | ADMIN capture; existing role redirects recorded |
| `/settings/store-groups` | PageHeader, Card, Table, Select | ADMIN capture; existing role redirects recorded |
| `/settings/units` | PageHeader, Card, Table, ResponsiveDataList, Modal | ADMIN capture; existing role redirects recorded |
| `/settings/users` | PageHeader, Card, Table, ResponsiveDataList, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/settings/whats-new` | PageHeader, Card | ADMIN capture; existing role redirects recorded |
| `/stores/[id]/compliance` | PageHeader, Card, Select | Isolated entity capture at 1440 and 390; normal domain-service fixture |
| `/stores/[id]/hardware` | PageHeader, Card, Select | Isolated entity capture at 1440 and 390; normal domain-service fixture |
| `/stores/new` | AppShell / composed workflow | ADMIN capture; existing role redirects recorded |
| `/stores` | PageHeader, Card, Table, ResponsiveDataList, Select, Modal | ADMIN capture; existing role redirects recorded |
| `/suppliers/new` | AppShell / composed workflow | ADMIN capture; existing role redirects recorded |
| `/suppliers` | PageHeader, Card, Table, ResponsiveDataList, Modal | ADMIN capture; existing role redirects recorded |

### PageHeader (63 source files)

- `src/app/(app)/reports/analytics/page.tsx`
- `src/app/(app)/reports/page.tsx`
- `src/app/(app)/reports/exports/page.tsx`
- `src/app/(app)/pos/shifts/page.tsx`
- `src/app/(app)/pos/page.tsx`
- `src/app/(app)/operations/integrations/page.tsx`
- `src/app/(app)/products/page.tsx`
- `src/app/(app)/operations/integrations/product-image-studio/page.tsx`
- `src/app/(app)/reports/close/page.tsx`
- `src/app/(app)/pos/history/page.tsx`
- `src/app/(app)/sales/orders/page.tsx`
- `src/app/(app)/operations/integrations/bazaar-catalog/page.tsx`
- `src/app/(app)/products/[id]/page.tsx`
- `src/app/(app)/products/new/page.tsx`
- `src/app/(app)/pos/registers/page.tsx`
- `src/app/(app)/sales/orders/[id]/page.tsx`
- `src/app/(app)/operations/integrations/m-market/page.tsx`
- `src/app/(app)/settings/categories/page.tsx`
- `src/components/page-header.tsx`
- `src/app/(app)/sales/orders/new/page.tsx`
- `src/components/pos/receipt-registry.tsx`
- `src/app/(app)/help/compliance/page.tsx`
- `src/app/(app)/settings/import/page.tsx`
- `src/components/inventory/receiving-workflow.tsx`
- `src/app/(app)/sales/orders/metrics/page.tsx`
- `src/app/(app)/operations/integrations/bakai-store/page.tsx`
- `src/app/(app)/pos/kkm/page.tsx`
- `src/components/inventory/transfer-workflow.tsx`
- `src/app/(app)/settings/diagnostics/page.tsx`
- `src/app/(app)/onboarding/page.tsx`
- `src/app/(app)/suppliers/page.tsx`
- `src/app/(app)/settings/users/page.tsx`
- `src/app/(app)/pos/debts/page.tsx`
- `src/app/(app)/settings/profile/page.tsx`
- `src/app/(app)/purchase-orders/page.tsx`
- `src/app/(app)/billing/page.tsx`
- `src/components/inventory/write-off-workflow.tsx`
- `src/app/(app)/settings/store-groups/page.tsx`
- `src/app/(app)/purchase-orders/[id]/page.tsx`
- `src/app/(app)/dashboard/page.tsx`
- `src/app/(app)/settings/attributes/page.tsx`
- `src/app/(app)/baam/page.tsx`
- `src/app/(app)/purchase-orders/new/page.tsx`
- `src/app/(app)/settings/units/page.tsx`
- `src/app/(app)/operations/integrations/email-marketing/workspace.tsx`
- `src/app/(app)/settings/printing/page.tsx`
- `src/app/(app)/settings/whats-new/page.tsx`
- `src/app/(app)/stores/page.tsx`
- `src/app/(app)/customers/page.tsx`
- `src/app/(app)/stores/[id]/compliance/page.tsx`
- `src/app/(app)/stores/[id]/hardware/page.tsx`
- `src/app/(app)/platform/page.tsx`
- `src/app/(app)/operations/integrations/o-market/page.tsx`
- `src/app/(app)/operations/integrations/bazaar-api/page.tsx`
- `src/app/(app)/admin/jobs/page.tsx`
- `src/app/(app)/admin/support/page.tsx`
- `src/app/(app)/inventory/counts/page.tsx`
- `src/app/(app)/inventory/counts/[id]/page.tsx`
- `src/app/(app)/admin/metrics/page.tsx`
- `src/app/(app)/inventory/movements/page.tsx`
- `src/app/(app)/inventory/page.tsx`
- `src/app/(app)/dev/scanner-test/scanner-test-client.tsx`
- `src/app/(app)/inventory/movements/[id]/page.tsx`

### Tables (41 source files)

- `src/app/(app)/reports/analytics/page.tsx`
- `src/app/(app)/reports/page.tsx`
- `src/app/(app)/reports/exports/page.tsx`
- `src/app/(app)/reports/close/page.tsx`
- `src/components/import-preview-table.tsx`
- `src/app/(app)/billing/page.tsx`
- `src/app/(app)/inventory/counts/page.tsx`
- `src/app/(app)/inventory/counts/[id]/page.tsx`
- `src/app/(app)/inventory/page.tsx`
- `src/components/pos/receipt-preview-modal.tsx`
- `src/components/pos/receipt-registry.tsx`
- `src/app/(app)/inventory/movements/[id]/page.tsx`
- `src/components/import-dry-run-preview.tsx`
- `src/components/product-description-generation-progress.tsx`
- `src/app/(app)/stores/page.tsx`
- `src/app/(app)/platform/page.tsx`
- `src/app/(app)/admin/jobs/page.tsx`
- `src/app/(app)/sales/orders/page.tsx`
- `src/app/(app)/products/[id]/page.tsx`
- `src/app/(app)/pos/sell/page.tsx`
- `src/app/(app)/pos/debts/page.tsx`
- `src/app/(app)/sales/orders/[id]/page.tsx`
- `src/app/(app)/settings/import/page.tsx`
- `src/app/(app)/settings/attributes/page.tsx`
- `src/app/(app)/suppliers/page.tsx`
- `src/app/(app)/admin/metrics/page.tsx`
- `src/app/(app)/operations/integrations/product-image-studio/page.tsx`
- `src/app/(app)/settings/store-groups/page.tsx`
- `src/app/(app)/settings/users/page.tsx`
- `src/app/(app)/sales/orders/metrics/page.tsx`
- `src/app/(app)/purchase-orders/page.tsx`
- `src/app/(app)/operations/integrations/bazaar-catalog/page.tsx`
- `src/app/(app)/customers/page.tsx`
- `src/app/(app)/operations/integrations/email-marketing/workspace.tsx`
- `src/app/(app)/purchase-orders/[id]/page.tsx`
- `src/app/(app)/operations/integrations/m-market/page.tsx`
- `src/app/(app)/settings/units/page.tsx`
- `src/app/(app)/operations/integrations/bakai-store/page.tsx`
- `src/app/(app)/operations/integrations/o-market/page.tsx`
- `src/app/(app)/operations/integrations/bazaar-api/page.tsx`
- `src/app/(app)/purchase-orders/new/page.tsx`

### Select (65 source files)

- `src/app/(app)/admin/metrics/page.tsx`
- `src/app/(app)/admin/support/page.tsx`
- `src/app/(app)/customers/page.tsx`
- `src/app/(app)/dashboard/page.tsx`
- `src/app/(app)/inventory/counts/[id]/page.tsx`
- `src/app/(app)/inventory/counts/page.tsx`
- `src/app/(app)/inventory/movements/page.tsx`
- `src/app/(app)/inventory/page.tsx`
- `src/app/(app)/onboarding/page.tsx`
- `src/app/(app)/operations/integrations/bakai-store/page.tsx`
- `src/app/(app)/operations/integrations/bazaar-api/page.tsx`
- `src/app/(app)/operations/integrations/bazaar-catalog/page.tsx`
- `src/app/(app)/operations/integrations/email-marketing/workspace.tsx`
- `src/app/(app)/operations/integrations/m-market/page.tsx`
- `src/app/(app)/operations/integrations/o-market/page.tsx`
- `src/app/(app)/operations/integrations/product-image-studio/page.tsx`
- `src/app/(app)/platform/page.tsx`
- `src/app/(app)/pos/debts/page.tsx`
- `src/app/(app)/pos/history/page.tsx`
- `src/app/(app)/pos/kkm/page.tsx`
- `src/app/(app)/pos/page.tsx`
- `src/app/(app)/pos/registers/page.tsx`
- `src/app/(app)/pos/sell/page.tsx`
- `src/app/(app)/pos/shifts/page.tsx`
- `src/app/(app)/products/[id]/page.tsx`
- `src/app/(app)/products/new/page.tsx`
- `src/app/(app)/products/page.tsx`
- `src/app/(app)/purchase-orders/[id]/page.tsx`
- `src/app/(app)/purchase-orders/new/page.tsx`
- `src/app/(app)/purchase-orders/page.tsx`
- `src/app/(app)/reports/analytics/page.tsx`
- `src/app/(app)/reports/close/page.tsx`
- `src/app/(app)/reports/exports/page.tsx`
- `src/app/(app)/reports/page.tsx`
- `src/app/(app)/sales/orders/[id]/page.tsx`
- `src/app/(app)/sales/orders/metrics/page.tsx`
- `src/app/(app)/sales/orders/new/page.tsx`
- `src/app/(app)/sales/orders/page.tsx`
- `src/app/(app)/settings/attributes/page.tsx`
- `src/app/(app)/settings/categories/page.tsx`
- `src/app/(app)/settings/import/page.tsx`
- `src/app/(app)/settings/printing/page.tsx`
- `src/app/(app)/settings/profile/page.tsx`
- `src/app/(app)/settings/store-groups/page.tsx`
- `src/app/(app)/settings/users/page.tsx`
- `src/app/(app)/stores/[id]/compliance/page.tsx`
- `src/app/(app)/stores/[id]/hardware/page.tsx`
- `src/app/(app)/stores/page.tsx`
- `src/app/invite/[token]/page.tsx`
- `src/app/register-business/[token]/page.tsx`
- `src/app/signup/page.tsx`
- `src/components/analytics-charts.tsx`
- `src/components/catalog/public-catalog-page.tsx`
- `src/components/import-dry-run-preview.tsx`
- `src/components/inventory/receiving-workflow.tsx`
- `src/components/inventory/transfer-workflow.tsx`
- `src/components/inventory/write-off-workflow.tsx`
- `src/components/phone-number-input.tsx`
- `src/components/pos/receipt-registry.tsx`
- `src/components/product-form.tsx`
- `src/components/products/product-duplicate-dialog.tsx`
- `src/components/responsive-data-list.tsx`
- `src/components/saved-table-views.tsx`
- `src/components/table/InlineEditableCell.tsx`
- `src/components/ui/data-table.tsx`

### Modal (40 source files)

- `src/app/(app)/admin/jobs/page.tsx`
- `src/app/(app)/billing/page.tsx`
- `src/app/(app)/customers/page.tsx`
- `src/app/(app)/inventory/counts/[id]/page.tsx`
- `src/app/(app)/inventory/counts/page.tsx`
- `src/app/(app)/inventory/movements/page.tsx`
- `src/app/(app)/inventory/page.tsx`
- `src/app/(app)/operations/integrations/bakai-store/page.tsx`
- `src/app/(app)/operations/integrations/bazaar-api/page.tsx`
- `src/app/(app)/operations/integrations/email-marketing/workspace.tsx`
- `src/app/(app)/operations/integrations/m-market/page.tsx`
- `src/app/(app)/platform/page.tsx`
- `src/app/(app)/pos/history/page.tsx`
- `src/app/(app)/pos/page.tsx`
- `src/app/(app)/pos/registers/page.tsx`
- `src/app/(app)/pos/sell/page.tsx`
- `src/app/(app)/products/[id]/page.tsx`
- `src/app/(app)/products/page.tsx`
- `src/app/(app)/purchase-orders/[id]/page.tsx`
- `src/app/(app)/purchase-orders/new/page.tsx`
- `src/app/(app)/reports/analytics/page.tsx`
- `src/app/(app)/sales/orders/[id]/page.tsx`
- `src/app/(app)/settings/attributes/page.tsx`
- `src/app/(app)/settings/import/page.tsx`
- `src/app/(app)/settings/units/page.tsx`
- `src/app/(app)/settings/users/page.tsx`
- `src/app/(app)/stores/page.tsx`
- `src/app/(app)/suppliers/page.tsx`
- `src/components/app-shell.tsx`
- `src/components/catalog/public-catalog-page.tsx`
- `src/components/command-palette.tsx`
- `src/components/guidance/page-tips-button.tsx`
- `src/components/help/ContextualHelpButton.tsx`
- `src/components/pos/receipt-preview-modal.tsx`
- `src/components/product-form.tsx`
- `src/components/products/catalog-discount-dialog.tsx`
- `src/components/products/product-duplicate-dialog.tsx`
- `src/components/pwa-install-button.tsx`
- `src/components/saved-table-views.tsx`
- `src/components/ui/use-confirm-dialog.tsx`

### Scoped preferences (3 source files)

- `src/app/(app)/inventory/page.tsx`
- `src/components/command-palette.tsx`
- `src/app/(app)/products/page.tsx`

### Inline editor (8 source files)

- `src/components/inventory/stock-quantity-cell.tsx`
- `src/app/(app)/inventory/page.tsx`
- `src/components/table/InlineEditableCell.tsx`
- `src/app/(app)/suppliers/page.tsx`
- `src/app/(app)/products/page.tsx`
- `src/app/(app)/settings/users/page.tsx`
- `src/app/(app)/settings/units/page.tsx`
- `src/app/(app)/stores/page.tsx`
