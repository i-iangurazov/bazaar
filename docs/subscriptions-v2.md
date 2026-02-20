# Subscriptions V2 (RU/KGS)

## План-каталог (SSoT)
- Коды: `STARTER`, `BUSINESS`, `ENTERPRISE`
- Отображаемые названия (i18n):
  - `plans.starter.name`: «Новичок»
  - `plans.business.name`: «Бизнесмен»
  - `plans.enterprise.name`: «Монополист»

## Лимиты (жесткое серверное ограничение)
- `STARTER`: до 1 магазина, до 100 товаров, до 5 активных пользователей
- `BUSINESS`: до 3 магазинов, до 500 товаров, до 10 активных пользователей
- `ENTERPRISE`: до 10 магазинов, до 1000 товаров, до 20 активных пользователей

## Цены (KGS)
- Фиксированные цены/мес:
  - `STARTER`: `1750 сом`
  - `BUSINESS`: `4375 сом`
  - `ENTERPRISE`: `8750 сом`
- Override env (опционально):
  - `PLAN_PRICE_STARTER_KGS`
  - `PLAN_PRICE_BUSINESS_KGS`
  - `PLAN_PRICE_ENTERPRISE_KGS`
  - при override берется точное значение (без пересчета в USD)

## Feature allowances
- `STARTER`:
  - включено: `priceTags`, `customerOrders`
  - отключено: `imports`, `exports`, `analytics`, `compliance`, `supportToolkit`, `pos`, `stockCounts`, `storePrices`, `bundles`, `expiryLots`, `periodClose`, `kkm`
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
  - цену в KGS (primary) + USD label
  - usage meters (stores/users/products)
  - `LIMIT_EXCEEDED` banner
  - checklist модулей (check/lock)
  - comparison table (3 плана)
  - CTA: WhatsApp + request upgrade

## Тесты (минимум)
- `plan-limits.test.ts`:
  - starter cannot create 2nd store
  - starter cannot exceed 100 products
  - starter cannot exceed 5 active users
- `plan-features.test.ts`:
  - starter exports/analytics -> FORBIDDEN + proper key
  - business imports/exports/analytics -> allowed
- `billing.test.ts`:
  - rounded `priceKgs`
  - limits/features returned correctly

## QA checklist
- `pnpm lint`
- `pnpm typecheck`
- `pnpm i18n:check`
- `CI=1 pnpm test:ci`
- `pnpm build`
