# Проверка готовности самостоятельного продвижения BAZAAR · 11 ноября 2026

**Текущее состояние:** в Instagram опубликованы и проверены **12 публикаций**. Сохранены **7 нативных проектов Canva / 98 редактируемых страниц**. Код прошёл изолированные DB-проверки, узкие регрессии и итоговую локальную production-сборку. Настоящий GA SDK проверен в локальном интерфейсе: до разрешения Google-запросов нет, лишний автоматический просмотр устранён, получение `sign_up` подтверждено GA4 Realtime. Мобильное оформление профиля и связь Page ↔ Instagram ещё не завершены. **Production gate выключен; push и deployment не разрешены и не выполнялись.** Платная реклама не запущена.

Изменения подготовлены в отдельном clone `/private/tmp/bazaar-marketing-main-20261111`, ветка **`main`**. Исходная база `2c4355ed` последовательно обновлена на `1a85d7ad`, затем чистым rebase на **`origin/main` `be5a9375f69804a50470679b57c1340ab0bd0725`**. Последний upstream-коммит меняет только fixtures `admin-workspace-recovery.test.tsx`; пересечений с маркетинговыми файлами нет. До SDK-followup локальный HEAD — **`f882bfb8eefcc5d7a7f501ce240e7a58ee5e0dd3`**, предыдущий маркетинговый коммит — `8c7def24`. Поверх этого HEAD проверены пять SDK-файлов: `src/lib/marketingAnalytics.ts`, `src/app/signup/page.tsx`, `tests/unit/marketing-analytics.test.ts`, `tests/unit/signup-page.test.tsx`, `MEASUREMENT-20261111.md`. Вместе с текущим отчётом и README они фиксируются отдельным review-коммитом; его точный SHA и bundle записываются в локальном backup manifest после commit. Основная папка с чужой работой на `codex/playground` не использовалась для продуктовых изменений.

## Scope кода

| Область | Конкретные изменения |
| --- | --- |
| Публичные языковые страницы | `/ru`, `/kg`, `/en` показывают маркетинговый лендинг на языке URL; `/ky` переводится на `/kg`. Язык задаётся проверенным внутренним header из middleware; входящий пользовательский header удаляется. Вложенные прежние языковые aliases сохраняют обработку. |
| Локаль | `normalizeLocale` проверяет собственные ключи legacy map и не принимает унаследованные имена прототипа за язык. Переключатель маркетингового языка сохраняет query и hash. |
| SEO | Канонические языковые URL, hreflang, Open Graph, metadataBase; локализованные метаданные главной и справки; дополненный sitemap. Приватные маршруты исключены в robots, приложение и Login получают соответствующий noindex. Это не замена авторизации. |
| Публичные факты | Structured data приложения/издателя с BAZAAR, оригинальным логотипом, @bazaar.pos и подтверждёнными контактами. Названия тарифов в RU/KG/EN — Новичок, Бизнесмен, Монополист. Новых продуктовых или платёжных обещаний нет. |
| First-party атрибуция | Существующий первый UTM-источник на 30 дней сохранён; capture расширен на индексируемые языковые корни. Метки записываются при успешном создании заявки/аккаунта. DNT/GPC и ограничения формата сохранены. Новая миграция для этой доработки не добавлена. |
| Опциональная GA4 | `MarketingAnalytics`, `marketingAnalytics.ts`, закрытый `marketingCampaigns.ts`. Без `NEXT_PUBLIC_GA4_ENABLED=true` и корректного публичного ID нет Google tag и баннера. До явного разрешения tag не загружается; отказ/отзыв и DNT/GPC учитываются. |
| Bootstrap и page context | Известный явный grant задаётся до config, рекламные согласия denied. Глобальный и config `send_page_view:false` исключают штатный автоматический просмотр; лишнего consent update после config нет. Только global set получает безопасный текущий публичный путь/title и пустой referrer, обновляемые перед manual view; config не перекрывает этот изменяемый контекст. |
| Данные GA4 | Только фиксированные публичные пути, очищенные page_location, пустой referrer, фиксированные title и 13 проверенных campaign_* комбинаций. Добавлена ровно одна Facebook website связка: `facebook / organic_social / profile / page`, без term. Не отправляются поля форм, контакты, business/user IDs, токены или произвольные UTM. Остальные неизвестные комбинации отклоняются. |
| Граница SDK | После загружавшегося SDK переход в приватную часть создаёт новый документ с предварительным ga-disable. Private→public также получает чистый документ до bootstrap; программный переход из документа с приватной историей не может загрузить tag до полного replace. Модификаторы, target, downloads и обычные публичные переходы сохраняют поведение браузера. |
| Восстановление и согласие | `pageshow.persisted` повторно проверяет согласие при Back/Forward cache без сброса формы. Успешно сохранённый выбор не остаётся in-memory разрешением: очистка хранилища не восстанавливает старый grant. При неудавшейся записи применяется текущий выбор в этом документе. |
| Успех регистрации | Сервер возвращает `accountCreated:true` только после создания нового User и получения следующего пути; возобновление существующего аккаунта возвращает false. `sign_up` отправляется только при true. Перед приватным переходом callback SDK либо независимый 1000 мс deadline завершаются до ga-disable/full replace; ожидание идёт параллельно сохранению языка. Без согласия/инициализации задержки нет, API повторно не вызывается. Первый источник не перезаписывается при возобновлении. |
| Результат по бизнесам | Параметризованный read-only когортный SQL: аккаунты, уникальные бизнесы, товары, складские операции, завершённые продажи и подтверждённые оплаты. Тестовые, неподтверждённые платежи и повторное привлечение того же бизнеса исключены. Ручной возврат для инвойса, записанный не позднее `observed_at`, исключает этот инвойс без net/pro-rata; другой невозвращённый валидный инвойс сохраняет один бизнес. Cutoff нормализован к UTC для Prisma timestamp(3). |

Регистрация бизнеса на `/register-business/<token>` не отправляет `business_registered` из браузера и не загружает GA SDK. Полный результат регистрации/активации/оплаты учитывается собственным отчётом. Браузерный `purchase`, Meta Pixel, CAPI, GTM, Measurement Protocol и новая CRM не добавлены. Подтверждение платежа не устанавливается языковой моделью, кликом или возвратом платёжной страницы.

Сопутствующие материалы: [измерение](MEASUREMENT-20261111.md), [когортный SQL](acquisition-cohort-report.sql), [рекламные черновики](ADVERTISING-DRAFTS-20261111.md). В черновиках — два Meta Direct предложения и три Search-группы с шестью RSA; длины 42 заголовков и 18 описаний проверены, все укладываются в 30/90 символов. Денежные параметры запуска не задавались.

## Пройденные проверки

Этапы ниже относятся к последовательным редакциям; наборы пересекаются. Числа не суммируются как количество уникальных тестов.

| Этап | Результат | Граница доказательства |
| --- | --- | --- |
| Начальная совместная регрессия | **17 файлов / 161 тест — passed** | Исходная совместная редакция SEO и измерения. |
| Строгая граница приватного документа | **5 файлов / 45 тестов — passed** | Проверки после отказа от браузерного business_registered и введения границы документов. |
| Изменённые регрессии и реестр кампаний | **5 файлов / 73 теста — passed** | Проверены контролируемые campaign_*, capture, consent и privacy. Лог `qa-code/changed-regressions.log`, exit 0. |
| History, BFCache и consent | **4 файла / 74 теста — passed** | Последние исправления: private→public→Back/Forward, stale pathname, ссылки/модификаторы, очистка согласия и read-only storage. 1,89 секунды, один worker. |
| Локаль | **3 файла / 34 теста — passed** | Регрессии языковых корней, request locale и нормализации языка. |
| Реальная изолированная БД | **2 файла / 8 тестов — passed** | Сохранение первого источника, повторные запросы, новые/возобновлённые аккаунты, создание бизнеса и когортные результаты. 4,57 секунды Vitest. |
| Новый main: БД | **2 файла / 14 тестов — passed** | После rebase на `1a85d7ad`: прежние 8 проверок плюс full/partial refund, другой валидный invoice, чужая организация и cutoff до/ровно/после записи. Срезы совпали в UTC и Asia/Bishkek. 5,30 секунды Vitest. |
| Новый main: узкие unit | **2 файла / 51 тест — passed** | Закрытый реестр, единственная новая Facebook связка и её недопустимые варианты; upstream-семантика confirmed-paid-MRR с возвратами. 0,237 секунды Vitest. |
| Typecheck предыдущей редакции | **passed**, exit 0 | `pnpm exec tsc --noEmit`; лог `qa-code/typecheck.log`. Итоговые проверки нового main приведены отдельно ниже. |
| Lint предыдущей редакции | **passed**, exit 0 | `pnpm lint`; лог `qa-code/lint.log`. |
| Переводы предыдущей редакции | **passed**, exit 0 | `pnpm i18n:check`; лог `qa-code/translations.log`. |
| Production build предыдущей редакции | **passed** | Ранняя локальная сборка, не production deployment. Последующие совместные проверки приведены отдельно ниже. |
| Typecheck после history/consent и locale | **passed**, 48,01 с | `pnpm typecheck`, один процесс; `qa-code/final-typecheck.log`. Исходный base `2c4355ed`. |
| Lint после history/consent и locale | **passed**, 1,51 с | `pnpm lint`; `qa-code/final-lint.log`. |
| Production build после history/consent и locale | **passed**, 86,02 с | `pnpm exec next build --no-lint`, один worker, lower priority, только синтетическая локальная конфигурация; реальный GA ID и включённый gate только в локальном QA. `qa-code/final-build.log`, `final-checks-outcome.json`. Миграции и deploy lifecycle не запускались. |
| Итоговый typecheck нового main | **passed**, exit 0, 38,47 с | Последняя rebased-редакция с refund/registry-поправками; `qa-code/rebased-main/typecheck.log`. |
| Итоговый lint нового main | **passed**, exit 0, 2,00 с | `qa-code/rebased-main/lint.log`. |
| Итоговые переводы нового main | **passed**, exit 0, 0,38 с | `qa-code/rebased-main/translations.log`. |
| Итоговый локальный production build нового main | **passed**, exit 0, 73,60 с | Один worker, синтетическая локальная конфигурация, без production-подключений. Реальный GA ID и enabled gate использованы только для локального preview. `qa-code/rebased-main/build.log` и `outcome.json`. Это не проверка настоящего SDK и не deployment. |
| Rebase на `be5a9375` | **passed**, 44 recovery-теста, typecheck exit 0 | `qa-code/rebased-be5a/`: recovery-команда 2,10 с, tsc 4,82 с. До/после идентичны tree/blob hashes `src`, `prisma`, `public`, `messages`, `package.json`, `pnpm-lock.yaml`, `next.config.mjs`; первоначальная сборка не повторялась из-за единственного upstream test-only изменения. |
| SDK bootstrap, доставка и публичный context | **4 файла / 93 теста — passed** | Последняя узкая пачка после удаления page_* из config: 2,26 с Vitest / 3,29 с команда. Callback/timeout без повторного API-вызова из onSuccess, успешный/возобновлённый аккаунт, сбой locale, consent/history/private guards, очищенный /ru→signup context и один config. `qa-code/sdk-fixes/public-context/unit-config-inheritance-outcome.json`. |
| Typecheck SDK-редакции | **passed**, exit 0, 4,49 с | `pnpm exec tsc --noEmit`; `qa-code/sdk-fixes/public-context/outcome.json`. После него только удалены три config-поля и уточнены проверки, типы и интерфейсы не менялись. |
| Lint SDK-редакции | **passed**, exit 0, 1,29 с | `pnpm lint`, без ESLint warnings/errors; тот же outcome. |
| Переводы SDK-редакции | **passed**, exit 0, 0,31 с | `pnpm i18n:check`; новых строк интерфейса не добавлялось. |
| Финальная SDK production-сборка | **passed**, exit 0, 81,23 с | Только локальная сборка с синтетической конфигурацией и одним worker. `qa-code/sdk-final-build/outcome.json`, `build.log`. Миграции, deploy lifecycle и production-подключения не запускались. |
| Чистота diff | **passed** | `git diff --check` после rebase и refund/registry-поправок. |

Последняя узкая команда:

```text
pnpm exec vitest run tests/unit/marketing-analytics.test.ts tests/unit/marketing-analytics-consent.test.tsx tests/unit/marketing-campaigns.test.ts tests/unit/signup-page.test.tsx --maxWorkers=1 --no-file-parallelism
```

DB-команда:

```text
pnpm exec vitest run tests/marketing/acquisition.integration.test.ts tests/marketing/acquisition-report.integration.test.ts --maxWorkers=1 --no-file-parallelism
```

DB-тесты выполнялись Node 22.23.4 / PostgreSQL 16 в **новом собственном одноразовом кластере**: `127.0.0.1:56375`, база `bazaar_hardening_ci`, один worker, включённые safety guards и отключённые внешние провайдеры. Все миграции применялись только туда; `.env` и production БД не использовались. Кластер работал 07:28:42–07:28:49 UTC, затем остановлен; listener отсутствовал, временная data-папка удалена. Исправлений тестов или SQL по результатам этого запуска не потребовалось.

Повторный прогон после rebase, 08:33:06–08:33:17 UTC, использовал отдельный кластер этой root-задачи для UI QA: `127.0.0.1:56375/bazaar_hardening_ci`, роль `postgres`, data_directory `/private/tmp/bazaar-marketing-ui-qa-20261111-sb12ssk_/postgres-data`. До разрешённого test reset проверены точная identity и нулевые User/Organization/Store/AccessRequest. После safety helper обновлён Prisma Client и применена единственная недостающая upstream-миграция `20261111020000_manual_subscription_refunds`. Тесты запускались последовательно, один worker, без провайдеров. После cleanup эти четыре таблицы и ManualSubscriptionRefund снова пустые. PG и Redis оставлены работающими для последующего UI QA; кластер не пересоздавался и не останавливался.

Логи и локальные снимки хранятся отдельно от Git в основной папке проекта:

`/Users/ilias_iangurazov/Commercial/bazaar/artifacts/instagram-canva-20261103/prelaunch-20261111/`

Для ранних проверок кода: `qa-code/outcomes.json`, `typecheck.log`, `lint.log`, `translations.log`, `build.log`. Для итогового нового main: `qa-code/rebased-main/outcome.json`, `typecheck.log`, `lint.log`, `translations.log`, `build.log`. Для первой БД: `qa-db/outcome.json`, `tests.log`, `initdb.log`, `postgres.log`, `stop.log`. Для DB/unit-проверок нового main: `qa-db/rebased-main/outcome.json`, `safety.log`, `generate.log`, `migrate.log`, `tests.log`, `unit-registry-refund.log`, `cleanup.log`. Результат более раннего build не переносится автоматически на финальную редакцию.

Для последней редакции: `qa-code/sdk-fixes/public-context/` содержит узкие результаты и review patch, `qa-code/sdk-final-build/` — финальную сборку. До SDK-followup проверенная цепочка коммитов сохранена в `qa-code/commit-backups/BAZAAR-marketing-main-20261111-f882bfb8.bundle`; после фиксации followup создаётся отдельный bundle всей маркетинговой цепочки поверх `be5a9375`.

## Настоящий SDK и UI-путь регистрации

Корневой агент проверял личный Chrome на локальной сборке. После отказа Google-запросов было **0 из 51** общих запросов страницы. После разрешения — tag и **один** ручной `/ru` page_view. После перехода на `/signup` и создания нового тестового пользователя — **4 Google-запроса в текущем документе:** tag, два публичных page_view, `sign_up`. Ранее наблюдавшийся дополнительный автоматический `/` page_view больше не появился.

GA4 Realtime подтвердил получение `sign_up` с `page_location` ровно `https://www.bazaar.kg/signup`; снимок `google-analytics-realtime-signup-confirmed.png`. Chrome показывал `unknown: page unloaded while inflight`, не `canceled`. Старые HAR опускали такую запись, а новый экспорт не завершился из-за Save Panel. Поэтому HTTP 204 для `sign_up` из HAR не заявляется, а раннее отсутствие completed entry не считается доказательством потери. Callback/deadline — усиление устойчивости перехода, а не подтверждение приёма Google; последнее отдельно получено в Realtime.

На приватной token-странице и после Back на неё Google script tags отсутствовали; Back-факт записан в `qa-ui/sdk-final-boundary-facts.json`. После отзыва и reload новый DOM `/` также не содержит Google script tags, кнопка настроек доступна; `qa-ui/sdk-final-revoke-dom.json`. На снимке `sdk-final-revoked-reload.png` Keep Log сохраняет четыре старых запроса: это не доказательство нулевого сетевого счётчика. Повторной инициализации tag после отзыва не наблюдалось. Полный честный протокол — `qa-ui/sdk-final-result.json`. Другие DNT/GPC/history/timeout сценарии покрыты указанными unit-тестами; это не расширяет фактически пройденную браузерную матрицу.

В принадлежащей задаче изолированной БД UI-проверка создала **2 тестовых пользователя**, без организаций и магазинов. Для первого источник точно `instagram / organic_social / profile / bio`; `qa-ui/signup-database-facts.json` подтверждает identity локальной БД и сохранённые метки. Production-клиентов, заявок и платежей этими действиями не создавали. Суммарные **3 тестовых sign_up** в Realtime относятся к нескольким QA-итерациям; их нельзя объявлять уникальными пользователями, квалифицированными заявками или результатом рекламы. UI GA4 Custom Events показывает `No custom events yet`; автоматических create-rules не обнаружено. Дополнительных client refs или изменений auth/idempotency по одному этому счётчику не добавляли.

## Внешние настройки, подтверждённые в UI

Эти факты переданы корневым агентом после осмотра личного Chrome Ilias. Они отделены от локальных unit/DB-проверок; этот документ сам не выполнял входов или внешних изменений.

| Сервис | Подтверждённое состояние | Что этим не подтверждено |
| --- | --- | --- |
| Google Analytics | Под `support@bazaar.kg` создан Analytics account **415819156**, property **563705120**, web stream **16318264286**, measurement ID **G-10VYCGLZEL**. Realtime подтвердил тестовый `sign_up` с безопасным `/signup` page_location. | Включение tag в production, реальные заявки и рекламные результаты. |
| Настройки GA4 | Enhanced Measurement **OFF**; Google Signals **OFF**; сбор user-provided data **OFF**; персонализация рекламы — **0 включённых регионов**. В Custom Events нет автоматических create-rules. Отзыв/reload проверен в новом DOM без Google tag. | Ненаблюдавшиеся браузерные сценарии не объявляются пройденными по одному unit-тесту; Google Keep Log не доказывает отсутствие новых запросов. |
| Search Console | Домен BAZAAR подтверждён; существующий sitemap принят со статусом success, **39 URL**; корневая страница проиндексирована. | Индексация всех 39 страниц, будущих языковых URL и какое-либо место в выдаче. Обновлённый локальный sitemap ещё не развёрнут. |
| Instagram | Подтверждён бизнес-тип **@bazaar.pos**; в профиле **12 публикаций**, все 12 URL и порядок проверены. Старые публикации архивировал владелец. Журнал — `publishing-status.json`; снимок `publishing-proof/profile-final-12-posts.png`. | Highlights и закрепления ещё не оформлены. Сетка обложки R01 требует мобильной корректировки; наличие публикации не подтверждает исправление crop. |
| Meta | Портфолио и подключённый Instagram проверены в UI. Instagram Connected assets показывает **1 Ad account — BAZAAR — Кыргызстан**, связь сохранена; `meta-instagram-ad-account-linked.png`. | Связь Facebook Page ↔ Instagram ещё не подтверждена, MBS не позволяет выбрать Instagram. Self-assign Content/Insights показал успех, но после reload 0 people; права не считаются подтверждёнными. Кампаний нет. |
| Meta Ads | Создан аккаунт **BAZAAR — Кыргызстан**, ID **1126506880111628**, владелец — портфолио **Bazaar KG 1399823171931350**, часовой пояс **UTC+6**, валюта **USD**. | Платёжный способ не добавлен, кампании не созданы; наличие кабинета не является рекламным запуском. |
| Google Ads | Подготовлен customer **743-404-7072** в режиме account-only: страна **Кыргызстан**, часовой пояс **UTC+6**, валюта **USD**. | **Account setup incomplete.** Остановлено до billing Submit, проверочной авторизации **$10** и использования предложенной существующей карты. Google Ads Terms не приняты. Платёжная настройка и создание готовой к показам кампании не выполнены. |
| Контент и Canva | Согласованный выпуск сохранён в **7 нативных Canva-проектах / 98 редактируемых страницах**; текст, логотипы и фотографии разделены. Базовое заполнение ленты — **12 опубликованных и проверенных публикаций**. | Stories/Highlights этим выпуском ещё не опубликованы; записей будущего автоматического планировщика нет. Редактируемые исходники не означают включённую автопубликацию. |

Снимки подтверждений: `google-analytics-stream-created.png`, `google-analytics-realtime-signup-confirmed.png`, `search-console-sitemap-success.png`, `search-console-home-indexed.png`, `instagram-business-created.png`, `meta-instagram-connected.png`, `meta-instagram-ad-account-linked.png`, `meta-page-link-unavailable.png`, `publishing-proof/profile-final-12-posts.png`. Они находятся в указанной локальной папке артефактов. Журнал публикаций читается как доказательство; этим отчётом он не изменялся.

## Production и оставшиеся проверки

Production-код и БД этой подготовкой не менялись; приложение не деплоилось, новые реальные заявки/регистрации/платежи для проверки не создавались. Read-only GET 11 ноября 06:56:53 UTC подтвердил уже существующий capture cookie `bazaar_acquisition` после языкового перехода: HTTP 200, HttpOnly, Secure, SameSite=Lax, 30 дней. Эта проверка не подтверждает запись новой заявки в production и не проверяет новые GA4-события.

Readiness gate для production остаётся выключенным. **Нет согласия на push в main и production deployment.** Реальный GA ID и включённый gate использованы только для локальной сборки и SDK QA. Публикации Instagram выполнены в пределах отдельного разрешения владельца; это не разрешение на выпуск приложения. Бюджет, добавление/использование карты и платная реклама отложены; приведённые внешние настройки не разрешают списания или запуск.

Остаются следующие конкретные результаты:

1. Завершить связь Page ↔ Instagram, Highlights и закрепления `about / p11 / start`; исправить crop обложки R01 в мобильном приложении. Эти действия ещё не выполнены. Для iPhone Mirroring ожидается личное подтверждение владельца в Apple UI; подключение не считается завершённым.
2. Получить отдельное разрешение на отправку готовых review-коммитов в `main`, связанный production deployment и, если согласовано, включение проверенного GA tag. После выпуска проверить публичный SHA, CI/smoke и реальный production consent flow. Нынешний SDK QA использовал локальный сайт и тестовую БД.
3. Google Ads account setup остаётся незавершённым до платёжного шага и принятия условий; бюджет, карта, проверочная авторизация и реклама отложены. В Meta кабинет создан без платёжного способа и кампаний. Готовые рекламные тексты не объявляются действующими кампаниями.
4. При реальных входящих вести квалификацию, показы и подтверждённые регистрации/оплаты. Тестовые регистрации и счётчики Google не дают CPQL/CAC или количества клиентов; эти показатели заполняются по фактическим обращениям и согласованным расходам.

Следующее обновление должно закрывать оставшиеся пункты только фактическими результатами с логом или UI-снимком. Базовое заполнение Instagram и локальная готовность измерения подтверждены в указанном объёме; production-выпуск приложения, завершённое мобильное оформление и рекламный запуск пока не выполнены.
