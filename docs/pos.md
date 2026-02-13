# POS (Касса)

## Назначение
POS-подсистема добавляет кассовый контур поверх текущей архитектуры (Next.js App Router + tRPC + Prisma) без изменения базовых инвариантов:
- tenant isolation по `organizationId`
- RBAC на сервере
- immutable inventory ledger (`StockMovement`)
- idempotency для критичных операций

## Роли
- `CASHIER` (также поддержан `STAFF` для обратной совместимости):
  - открытие смены
  - создание/редактирование кассовой продажи
  - проведение оплаты
  - старт возврата
  - cash in/out
- `MANAGER` / `ADMIN`:
  - закрытие смены (Z-подобное закрытие)
  - подтверждение завершения возврата
- `ADMIN`:
  - управление кассовыми регистрами

## Данные
Добавлены сущности:
- `PosRegister` — кассовый регистр в магазине
- `RegisterShift` — смена (с ограничением: одна `OPEN` смена на регистр)
- `SalePayment` — платежи по продаже/возврату (split tender)
- `CashDrawerMovement` — pay in / pay out
- `SaleReturn` и `SaleReturnLine` — документ возврата из истории продаж

Расширен `CustomerOrder`:
- POS-флаги и связи (`isPosSale`, `registerId`, `shiftId`)
- KKM readiness статусы (`kkmStatus`, `kkmReceiptId`, `kkmRawJson`)

## Потоки
### 1) Register -> Shift
- Открытие смены: `pos.shifts.open` (idempotent)
- Закрытие смены: `pos.shifts.close` (idempotent)
- X-отчет: `pos.shifts.xReport`

### 2) Продажа
- Создание черновика продажи: `pos.sales.createDraft`
- Добавление/редактирование позиций: `pos.sales.addLine|updateLine|removeLine`
- Завершение продажи: `pos.sales.complete` (idempotent)
- На завершении:
  - создаются `SALE` движения склада
  - создаются платежи `SalePayment`
  - публикуется realtime `sale.completed`

### 3) Возврат
- Возврат начинается из истории: `pos.returns.createDraft`
- Выбор строк и количества: `pos.returns.addLine|updateLine|removeLine`
- Завершение возврата: `pos.returns.complete` (idempotent)
- На завершении:
  - создаются компенсирующие складские движения (`ADJUSTMENT`, qty `+`)
  - создаются refund-платежи `SalePayment` (`isRefund=true`)
  - публикуется realtime `sale.refunded`

### 4) Cash in/out
- `pos.cash.record` (idempotent)
- Пишется неизменяемая запись `CashDrawerMovement`

## KKM-ready
Режим готовности для интеграции:
- при `StoreComplianceProfile.kkmMode = ADAPTER` POS пытается фискализировать чек через `adapter.fiscalizeReceipt(...)`
- результат сохраняется в `CustomerOrder.kkmStatus`
- это **KKM-ready hook**, а не заявление о юридическом соответствии

## UI маршруты
- `/pos` — точка входа
- `/pos/registers` — управление кассами
- `/pos/sell` — продажа
- `/pos/history` — история + возвраты
- `/pos/shifts` — смены, cash in/out, X/Z-подобные сценарии

## Ограничения текущей итерации
- возврат использует компенсирующее складское движение типа `ADJUSTMENT` (без отдельного `RETURN` enum)
- полноценная печать чека/KKT UI не включена
- внешние платежные провайдеры (терминал эквайринга) не подключены, хранится только `providerRef`
