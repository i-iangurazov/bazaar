# Currency and Localization Audit

## Current Architecture

- `Store.currencyCode` and `Store.currencyRateKgsPerUnit` exist in Prisma.
- `src/lib/currency.ts` supports currency normalization, conversion from/to KGS, and display formatting.
- Product forms and inline editing already convert display currency using store currency.
- Public catalog code already uses configurable catalog currency.
- Supported locales are `en`, `ru`, and `kg`.

## Findings

- `src/lib/i18nFormat.ts` still exports `formatCurrencyKGS` for explicit base-accounting use, but app-facing POS/report/admin screens should use `src/lib/currencyDisplay.ts` helpers when a store context exists.
- Price tag PDF generation accepts store currency code/rate and no longer hardcodes display as `KGS`.
- User-facing examples should avoid KGS-looking sample prices unless the selected store currency is actually KGS.
- Internal accounting columns and DB fields remain `*Kgs`; those names are storage semantics and should not automatically be renamed.
- Billing plan catalog is currently KGS-oriented; this may be acceptable if billing is not store-currency-aware, but UI should label it explicitly.

## Required Direction

- Display values using the selected store currency when a store context exists.
- Fall back to `KGS` only when no store/currency context is available.
- Keep DB/accounting values in KGS unless a broader financial migration is planned.
- Add all new UI strings to `messages/en.json`, `messages/ru.json`, and `messages/kg.json`.

## First Pass

- Change price tag PDF formatting to accept a currency code and rate.
- Use saved store print profile and store currency in fast print flows.
- Replace hardcoded KGS preview strings in product print UI with formatted selected currency where practical.

## Deep Pass

- POS, cash shifts, sales/orders, reports, purchase-order PDFs, receipt PDFs, receipt exports, and admin/platform metrics now use `src/lib/currencyDisplay.ts` helpers.
- See `docs/currency-deep-audit.md` for the current source of truth, intentional base-KGS surfaces, and remaining risks.
