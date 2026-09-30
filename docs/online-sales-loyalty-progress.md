# Online sales + loyalty programme — status

Owner request (2026-09-30). Everything is local `main` only: no push, no deploy,
no preview, no Vercel/Neon or production database changes.

## How to run and demo locally

First deployment (only against the confirmed local database):

```bash
pnpm db:up                     # local docker Postgres + Redis only
pnpm prisma:migrate            # apply additive migrations
pnpm prisma:seed               # demo users (admin@example.com / Admin123!)
pnpm loyalty:demo              # demo store/product/customers
```

Repeat runs (no migrations, no seed):

```bash
LOYALTY_OTP_DEV_OUTBOX=1 pnpm dev
```

`pnpm dev` does not need `CRON_SECRET`; only `pnpm build` does (its preflight
requires it). `pnpm prisma:migrate` and `pnpm prisma:seed` are NOT protected by the
demo guard — they act on whatever `DATABASE_URL` points at, so confirm the local
`DATABASE_URL` (localhost, docker) before running them. `pnpm loyalty:demo` itself
refuses any non-local host and never resets data.

Demo customers (dev database, current state):

- `demo-points@example.invalid` — **1000** points (opening balance written through
  the journal; untouched by my test runs, which use a separate test database).
- `demo-nopoints@example.invalid` — **0** points.

A newly registered account always starts at 0; only the prepared demo account has
1000.

Navigation path (one actual route each):

- Desktop: sidebar group **Администрирование → Программа лояльности**.
- Mobile: bottom bar **Ещё → Программа лояльности**.
- `/settings` is a section index page reached from the breadcrumb/back button; it is
  not a separate parallel menu.

`pnpm loyalty:demo` refuses any non-local database host and never resets data.
It creates the 1000 KGS demo product, `demo-points@example.invalid` (1000 opening
points written through the journal) and `demo-nopoints@example.invalid` (0), and
enables the programme only for the demo organization.

Local OTP codes are written to `tmp/loyalty-otp-outbox.log` (one line:
`timestamp`, `email`, `code`). This outbox is enabled only with
`LOYALTY_OTP_DEV_OUTBOX=1` and is refused in production / on Vercel. The code is
never returned by the normal API and there is no universal OTP.

Manual walkthrough: sign in as owner → **Настройки → Бонусы (Программа лояльности)**
→ open a store's registration QR → customer opens that link, requests a code, reads
it from the outbox file, confirms → lands on the card with balance, rules, history
and a short-lived QR with a countdown → show that QR at the register.

## Stage 1 — Online sales report — DONE

- "Онлайн-продажи" tab in existing analytics; two separate blocks (orders created
  vs completed sales/money), daily chart, server-paginated orders table, export.
- Online = `saleChannel=ONLINE`; unknown channel is a separate filter, never merged.
  Money received is shown only from real `SalePayment` rows, otherwise
  "Нет данных о платеже".
- Fixed `completePosSale`/`holdPosSaleDraft` so a register default can never
  downgrade a recorded ONLINE sale.
- Verified: local build, browser check, unit + reporting integration suites.

## Stage 2 — Programme rules + settings — DONE

- Rules: member discount 5%, earn 5%, 1 point = 1 KGS, max spend 50% after the
  member discount, promo positions excluded by default, larger-of member/promo.
  Disabled by default; only an explicit admin activation enables it.
- Admin UI at `/settings/loyalty`: enable switch, discount, earn rate, spend limit,
  min redeem, reservation TTL, promo options, participating stores.

## Stage 3 — Accounts, calculation, journal — DONE

- Schema + additive migrations: program, program stores, member, account,
  append-only ledger (`eventKey` unique), reservation, per-order snapshot.
- One shared server calculation (`calc.ts`); money via `Prisma.Decimal`, whole
  points rounded down.
- Atomic reservation guard on `LoyaltyAccount.reservedPoints`; expired reservations
  are swept and never reduce availability.

## Stage 4 — Registration, sessions, QR card — DONE

- Visible path: desktop sidebar **Администрирование → Программа лояльности** and
  mobile **Ещё → Программа лояльности**; new `/settings` index lists implemented
  sections for the current role; the loyalty page has "Назад в настройки".
- Store QR ("Регистрация покупателей") per participating store with store name and
  Открыть страницу / Скопировать ссылку / Скачать QR. The link is generated
  automatically — no manual slug.
- Customer identity is separate from staff auth: email OTP (hashed, TTL, attempt and
  rate limits), dedicated revocable httpOnly session cookie, no `User` row.
- Customer card: balance, available points, rules, history, large short-lived QR
  ("Показать кассиру") with countdown and refresh, plus a "У меня уже есть карта"
  re-entry link.
- QRs are rendered server-side and verified by decoding: a real scanner library
  decodes the store QR to the join URL and the customer QR to the opaque token, and
  `verifyCardToken` accepts that decoded value
  (`tests/integration/loyalty-qr.test.ts`).

## Stage 5 — Register and online-order integration — REGISTER DONE, ONLINE NOT

- Register: a single compact "Бонусы" button inside the existing customer dialog
  opens a separate dialog (scan card QR, member discount, available/max points,
  points to redeem, payable, will-earn, apply/remove). The shared server quote,
  reservation and confirmation are wired into the real completion
  (`completePosSale`), and the earning is granted only on a fully paid money part.
- Verified end-to-end through the real sale services
  (`tests/integration/loyalty-pos.test.ts`): 1000 → pay 950 / earn 47; balance 1000
  → redeem 475 / pay 475 / earn 23; insufficient balance fails loudly; a repeated
  completion changes nothing. Parallel orders on one account cannot spend the same
  points (`tests/integration/loyalty-orders.test.ts`).
- POS base screen unchanged: `tmp/pos-{desktop,tablet,mobile}-before.png` and
  `...-after.png` are byte-identical.
- NOT DONE: binding the customer card to the online catalogue order.

## Stage 6 — Returns — DONE (reporting display NOT)

- `reverseLoyaltyForReturn` now runs inside the same transaction as the money return
  (`completeSaleReturn`), using the original sale's saved rules and line
  distribution.
- Applying loyalty now writes the reduced price onto the order lines, so a full
  return refunds the money actually paid (475, not 1000) and the loyalty reversal
  lands exactly on the original amounts.
- Verified end-to-end through the real return services: 1000 start → redeem 475 /
  earn 23 → 548; full return → refund 475 KGS, +475 points, −23 points, balance
  1000; repeating the return changes nothing.
- NOT DONE: loyalty lines (member discount, points spent/earned/reversed) in
  analytics / order / customer card.

## Stage 7 — Local acceptance — PARTIAL

Verified by me in a browser: owner navigation → settings with a per-store
registration QR; customer registration through the local OTP outbox → card with the
balance, rules, history and a decodable QR; and the QRs decode with a real scanner
library into a token the register handler accepts.

Verified by tests only (services, not clicks): the register acceptance numbers
(950/47; redeem 475 → 475/23; insufficient balance fails; idempotent completion)
and the full/partial return control example.

NOT verified by me: the click-through of the register «Бонусы» dialog up to
payment, the online-order path, and the loyalty lines in analytics/order/customer.
POS base screen is byte-identical before/after
(`tmp/pos-{desktop,tablet,mobile}-{before,after}.png`).

## Exact continuation point

1. Browser pass of the register «Бонусы» dialog up to payment (open shift on `/pos`,
   add the demo product, customer dialog → Бонусы → scan/enter the card token →
   apply → pay).
2. Online catalogue checkout: bind the customer card and reuse
   `quoteLoyaltyForOrder` / `applyLoyaltyToOrder` / `confirmLoyaltyForOrder`.
3. Show loyalty lines (member discount, spent, earned, reversed) in analytics /
   order / customer card.

## Blockers

- None technical.

## Screenshots (tmp is gitignored)

- `tmp/loyalty-settings-index.png`, `tmp/loyalty-settings.png` (settings + QRs)
- `tmp/loyalty-card.png` (customer card with QR)
- `tmp/pos-{desktop,tablet,mobile}-{before,after}.png`
