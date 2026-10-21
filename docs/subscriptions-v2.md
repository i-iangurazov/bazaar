# Subscriptions V2 (RU/KGS)

## План-каталог (SSoT)
- Коды: `STARTER`, `BUSINESS`, `ENTERPRISE`
- `src/server/billing/planCatalog.ts` задаёт цены, лимиты и включённые модули. Лендинг, структурированные предложения поисковым системам и кабинет используют этот каталог.
- `src/lib/billing/plans.ts` задаёт общие идентификаторы, порядок планов и полный список модулей для сравнения.
- Отображаемые названия (i18n):
  - `billing.plans.starter.name`: «Новичок»
  - `billing.plans.business.name`: «Бизнесмен»
  - `billing.plans.enterprise.name`: «Монополист»

## Лимиты (жесткое серверное ограничение)
- `STARTER`: до 1 магазина, до 1000 товаров, до 5 активных пользователей
- `BUSINESS`: до 5 магазинов, до 5000 товаров, до 10 активных пользователей
- `ENTERPRISE`: до 15 магазинов, до 20000 товаров, до 20 активных пользователей

## Цены (KGS)
- Фиксированные цены/мес:
  - `STARTER`: `1750 сом`
  - `BUSINESS`: `4375 сом`
  - `ENTERPRISE`: `8750 сом`
- Override env (опционально):
  - `PLAN_PRICE_STARTER_KGS`
  - `PLAN_PRICE_BUSINESS_KGS`
  - `PLAN_PRICE_ENTERPRISE_KGS`
  - при override берется точное значение (без пересчета в USD), одинаковое на лендинге и в кабинете; дробная часть сохраняется при отображении.

## Feature allowances
- `STARTER`:
  - включено: `pos`, `priceTags`, `customerOrders`
  - отключено: `imports`, `exports`, `analytics`, `compliance`, `supportToolkit`, `stockCounts`, `storePrices`, `bundles`, `expiryLots`, `periodClose`, `kkm`
- `BUSINESS`:
  - включено: `imports`, `exports`, `analytics`, `pos`, `stockCounts`, `priceTags`, `storePrices`, `bundles`, `expiryLots`, `customerOrders`, `periodClose`
  - отключено: `compliance`, `supportToolkit`, `kkm`
- `ENTERPRISE`:
  - все перечисленные модули включены

## Enforcement points
- Лимиты:
  - `store.create` -> `planLimitStores`
  - `user.create|invite` -> `planLimitUsers`
  - `product.create|duplicate|import` -> `planLimitProducts`
- Фичи:
  - `imports` router/service -> `featureLockedImports`
  - `exports` router -> `featureLockedExports`
  - `analytics` router -> `featureLockedAnalytics`
  - `compliance` router -> `featureLockedCompliance`
  - `adminSupport` router -> `featureLockedSupportToolkit`
  - `pos` router -> `featureLockedPos`
  - `pos.kkm` subrouter -> `featureLockedKkm`
  - `stockCounts` router -> `featureLockedStockCounts`
  - `periodClose` router -> `featureLockedPeriodClose`
  - `storePrices` router -> `featureLockedStorePrices`
  - `bundles` router -> `featureLockedBundles`
  - `stockLots` router -> `featureLockedExpiryLots`
  - `salesOrders` router -> `featureLockedCustomerOrders`
  - `/api/price-tags/pdf` -> `featureLockedPriceTags`

## Upgrade / downgrade behavior
- Upgrade:
  - доступен только на тариф выше текущего
  - создается `PlanUpgradeRequest` (PENDING) + audit log
- Downgrade:
  - прямой downgrade через self-service не делается
  - при превышении лимитов новые сущности создать нельзя
- Состояние превышения:
  - вычисляется как `LIMIT_EXCEEDED` при `usage > limit`
  - существующие данные остаются, блокируется только дальнейший рост

## Совместимость и миграция
- Код планов в БД уже `STARTER|BUSINESS|ENTERPRISE`; SQL-миграция не нужна.
- Legacy mapping сохранен в runtime:
  - `PRO -> BUSINESS`
- Существующие org, уже превышающие новые лимиты, не ломаются: получают режим `LIMIT_EXCEEDED`.

## Billing UX
- `/billing` показывает:
  - текущий план (RU name)
  - цену в KGS, включая поддерживаемый серверный override
  - usage meters (stores/users/products)
  - `LIMIT_EXCEEDED` banner
  - checklist модулей (check/lock)
  - comparison table: все 3 плана и все 14 модулей
  - CTA: WhatsApp + request upgrade; автоматическая оплата пока не подключена

## Тесты (минимум)
- `plan-limits.test.ts`:
  - starter cannot create 2nd store
  - starter cannot exceed 1000 products
  - starter cannot exceed 5 active users
- `plan-features.test.ts`:
  - starter exports/analytics -> FORBIDDEN + proper key
  - business imports/exports/analytics -> allowed
- `billing.test.ts`:
  - точная цена `monthlyPriceKgs` без пересчета валют
  - limits/features returned correctly

## QA checklist
- `pnpm lint`
- `pnpm typecheck`
- `pnpm i18n:check`
- `CI=1 pnpm test:ci`
- `pnpm build`

## Изменение 21 октября 2026 года

Касса открыта на STARTER в соответствии с публичным обещанием. Новый бизнес остаётся на STARTER и может провести продажу в активный trial. Цены, лимиты, дополнительные feature gates и правила уже одобренного доступа не менялись. SQL-миграция для этого изменения не требуется.

Публичное сравнение показывает актуальные ограничения и включение каждого модуля. Список возможностей, порядок тарифов и названия RU/KG/EN согласованы с кабинетом.
