# Full Product Improvement Plan

## Scope

This pass covers the current Bazaar codebase as the source of truth: route protection, role access, shared UI system, barcode/price-tag printing, currency/localization, navigation, dashboard/POS/product/inventory/report workflows, seed safety, and validation.

## Priority Order

1. Document Shopify-inspired UI principles and current app audits.
2. Fix route protection and sensitive support export risks.
3. Add production guardrails for seeded demo credentials.
4. Establish sharp UI tokens in shared components.
5. Redesign barcode printing into saved setup plus fast action.
6. Apply role-aware navigation and workflow cleanup where it is safe.
7. Add targeted tests for changed security and print behavior.
8. Run validation commands and document remaining risks.

## Implementation Constraints

- Do not push without user review.
- Do not hardcode KGS for display.
- Keep existing business logic intact.
- Prefer small changes to shared primitives over risky one-off page rewrites.
- Add every new user-facing string to `messages/en.json`, `messages/ru.json`, and `messages/kg.json`.

## Current High-Risk Items

- `middleware.ts` protected prefixes are incomplete for several private app routes.
- Support bundle exports include broad audit/store data and need explicit sanitization.
- Seed creates public demo credentials unless guarded.
- Printing opens a large settings flow too often and mixes setup with execution.
- Shared UI primitives still encode rounded corners directly.

## Validation Plan

Run, in order, after implementation:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm i18n:check
pnpm build
```

If an environment-dependent command cannot run, record the exact command and error in `docs/final-improvement-summary.md`.
