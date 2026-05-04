# Currency and Localization Audit

## Current Architecture

- `Store.currencyCode` and `Store.currencyRateKgsPerUnit` exist in Prisma.
- `src/lib/currency.ts` supports currency normalization, conversion from/to KGS, and display formatting.
- Product forms and inline editing already convert display currency using store currency.
- Public catalog code already uses configurable catalog currency.
- Supported locales are `en`, `ru`, and `kg`.

## Findings

- `src/lib/i18nFormat.ts` still exports `formatCurrencyKGS`, and many POS/report/admin views use it directly.
- Price tag PDF generation formats currency as `KGS` internally.
- Some messages still say the system uses KGS or show sample prices as `0,00 KGS`.
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

## Remaining Risk

POS, reports, cash, exports, purchase-order PDFs, and admin metrics still need a deeper pass because they combine KGS storage fields with user-facing amounts across many screens and tests.
