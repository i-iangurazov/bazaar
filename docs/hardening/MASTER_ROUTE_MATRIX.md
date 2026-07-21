# Bazaar hardening master route matrix

Baseline: `4d7c9b33218b584334ca62f7a816f8997f144a10`

Phase A covers all 89 `page.tsx` routes found under `src/app`. `FAIL` means static evidence links the route to an open defect. `AUDITED` means source inventory found no route-specific defect; it is not a release pass. Every authenticated browser, responsive, theme, accessibility, performance, Preview, and production gate remains `NOT_RUN`.

The final release version of this matrix must replace every `NOT_RUN` with `PASS`, `FAIL`, or justified `NA`, across required roles, viewports, themes, data states, UI states, and actions.

| Route | Primary owner | Phase A static result | Open issue/evidence | Independent gate |
| --- | --- | --- | --- | --- |
| `/admin/jobs` | Agent 4 | FAIL | HARD-A4-009, HARD-A4-015 | NOT_RUN |
| `/admin/metrics` | Agent 4 | FAIL | HARD-A4-015 | NOT_RUN |
| `/admin/support` | Agent 4 | FAIL | HARD-A4-015 | NOT_RUN |
| `/billing` | Agent 4 | FAIL | HARD-A4-002, HARD-A4-015 | NOT_RUN |
| `/cash` | Agent 1; Agent 4 route-readiness gate | FAIL | HARD-A4-019 | NOT_RUN |
| `/customers/new` | Agent 3 | AUDITED | Entry route inventoried in Agent 3 audit | NOT_RUN |
| `/customers` | Agent 3 | FAIL | HARD-A3-006, HARD-A3-019 | NOT_RUN |
| `/dashboard` | Agent 4 | FAIL | HARD-A4-001, HARD-A4-008, HARD-A4-015, HARD-A4-017 | NOT_RUN |
| `/dev/scanner-test` | Agent 4 | AUDITED | Agent 4 route inventory | NOT_RUN |
| `/finance/expense` | Agent 4 | FAIL | HARD-A4-019 | NOT_RUN |
| `/finance/income` | Agent 4 | FAIL | HARD-A4-019 | NOT_RUN |
| `/help/compliance` | Agent 4 | AUDITED | Agent 4 route inventory | NOT_RUN |
| `/help` | Agent 4 | AUDITED | Agent 4 route inventory | NOT_RUN |
| `/inventory/counts/[id]` | Agent 2 | FAIL | HARD-A2-001, HARD-A2-006, HARD-A2-014 | NOT_RUN |
| `/inventory/counts/new` | Agent 2 | AUDITED | Redirect route; no static defect found | NOT_RUN |
| `/inventory/counts` | Agent 2 | FAIL | HARD-A2-001, HARD-A2-014 | NOT_RUN |
| `/inventory/movements/[id]` | Agent 2 | AUDITED | Agent 2 route inventory | NOT_RUN |
| `/inventory/movements` | Agent 2 | AUDITED | Agent 2 route inventory | NOT_RUN |
| `/inventory` | Agent 2 | FAIL | HARD-A2-007, HARD-A2-014 | NOT_RUN |
| `/inventory/receiving/[id]/edit` | Agent 2 | AUDITED | Agent 2 route inventory | NOT_RUN |
| `/inventory/receiving` | Agent 2 | FAIL | HARD-A2-017 | NOT_RUN |
| `/inventory/transfers/[id]/edit` | Agent 2 | AUDITED | Agent 2 route inventory | NOT_RUN |
| `/inventory/transfers` | Agent 2 | AUDITED | Agent 2 route inventory | NOT_RUN |
| `/inventory/write-offs/[id]/edit` | Agent 2 | AUDITED | Agent 2 route inventory | NOT_RUN |
| `/inventory/write-offs` | Agent 2 | AUDITED | Agent 2 route inventory | NOT_RUN |
| `/onboarding` | Agent 4 | AUDITED | Agent 4 route inventory | NOT_RUN |
| `/operations/integrations/bakai-store` | Agent 3 | FAIL | HARD-A3-008, HARD-A3-013, HARD-A3-014 | NOT_RUN |
| `/operations/integrations/bazaar-api` | Agent 3 | FAIL | HARD-A3-002 | NOT_RUN |
| `/operations/integrations/bazaar-catalog` | Agent 3 | FAIL | HARD-A3-008, HARD-A3-022, HARD-A3-025 | NOT_RUN |
| `/operations/integrations/email-marketing` | Agent 3 | FAIL | HARD-A3-015, HARD-A3-016, HARD-A3-018 | NOT_RUN |
| `/operations/integrations/m-market` | Agent 3 | FAIL | HARD-A3-008, HARD-A3-013, HARD-A3-014 | NOT_RUN |
| `/operations/integrations/o-market` | Agent 3 | FAIL | HARD-A3-008, HARD-A3-013, HARD-A3-014 | NOT_RUN |
| `/operations/integrations` | Agent 3 | AUDITED | Integration landing inventoried in Agent 3 audit | NOT_RUN |
| `/operations/integrations/product-image-studio` | Agent 3 | FAIL | HARD-A3-008, HARD-A3-024 | NOT_RUN |
| `/orders` | Agent 3 | AUDITED | Compatibility redirect to `/sales/orders` | NOT_RUN |
| `/platform` | Agent 4 | AUDITED | Platform-owner surface inventoried | NOT_RUN |
| `/pos/debts` | Agent 1 | FAIL | HARD-A1-001, HARD-A1-002, HARD-A1-007, HARD-A1-012, HARD-A1-014 | NOT_RUN |
| `/pos/history` | Agent 1 | FAIL | HARD-A1-001, HARD-A1-002, HARD-A1-003, HARD-A1-005, HARD-A1-007, HARD-A1-012–014, HARD-A1-017–019 | NOT_RUN |
| `/pos/kkm` | Agent 1 | FAIL | HARD-A1-001–003, HARD-A1-007, HARD-A1-009, HARD-A1-010, HARD-A1-014 | NOT_RUN |
| `/pos` | Agent 1 | FAIL | HARD-A1-007, HARD-A1-014, HARD-A1-016 | NOT_RUN |
| `/pos/receipts` | Agent 1 | FAIL | HARD-A1-001, HARD-A1-011, HARD-A1-017, HARD-A1-019 | NOT_RUN |
| `/pos/registers` | Agent 1 | FAIL | HARD-A1-003, HARD-A1-007, HARD-A1-014, HARD-A1-019 | NOT_RUN |
| `/pos/sell` | Agent 1 | FAIL | HARD-A1-002, HARD-A1-004–009, HARD-A1-013–015, HARD-A1-017–018 | NOT_RUN |
| `/pos/shifts` | Agent 1 | FAIL | HARD-A1-001–003, HARD-A1-006–007, HARD-A1-012–014, HARD-A1-018 | NOT_RUN |
| `/products/[id]` | Agent 2 | FAIL | HARD-A2-002, HARD-A2-003, HARD-A2-005, HARD-A2-013 | NOT_RUN |
| `/products/new` | Agent 2 | FAIL | HARD-A2-004, HARD-A2-005, HARD-A2-013, HARD-A2-017 | NOT_RUN |
| `/products` | Agent 2 | FAIL | HARD-A2-002, HARD-A2-003, HARD-A2-005, HARD-A2-014–016 | NOT_RUN |
| `/purchase-orders/[id]` | Agent 3 | FAIL | HARD-A3-007 | NOT_RUN |
| `/purchase-orders/new` | Agent 3 | FAIL | HARD-A3-004, HARD-A3-007 | NOT_RUN |
| `/purchase-orders` | Agent 3 | FAIL | HARD-A3-007, HARD-A3-012, HARD-A3-019 | NOT_RUN |
| `/reports/analytics` | Agent 4 | FAIL | HARD-A4-001, HARD-A4-017 | NOT_RUN |
| `/reports/close` | Agent 4 | FAIL | HARD-A4-006, HARD-A4-007, HARD-A4-016 | NOT_RUN |
| `/reports/exports` | Agent 4 | FAIL | HARD-A4-003, HARD-A4-012 | NOT_RUN |
| `/reports` | Agent 4 | FAIL | HARD-A4-008, HARD-A4-016 | NOT_RUN |
| `/reports/receipts` | Agent 1 domain; Agent 4 gate | FAIL | HARD-A1-011, HARD-A1-017, HARD-A1-019 | NOT_RUN |
| `/sales/orders/[id]` | Agent 3 | FAIL | HARD-A3-001, HARD-A3-009 | NOT_RUN |
| `/sales/orders/metrics` | Agent 3 domain; Agent 4 gate | FAIL | HARD-A3-019 | NOT_RUN |
| `/sales/orders/new` | Agent 3 | FAIL | HARD-A3-004, HARD-A3-009, HARD-A3-011 | NOT_RUN |
| `/sales/orders` | Agent 3 | FAIL | HARD-A3-019 | NOT_RUN |
| `/settings/attributes` | Agent 2 | FAIL | HARD-A2-013 | NOT_RUN |
| `/settings/categories` | Agent 2 domain; Agent 4 route guard | FAIL | HARD-A2-008, HARD-A4-011 | NOT_RUN |
| `/settings/diagnostics` | Agent 4 | AUDITED | Agent 4 route/procedure inventory | NOT_RUN |
| `/settings/import` | Agent 2 | FAIL | HARD-A2-005, HARD-A2-014 | NOT_RUN |
| `/settings/printing` | Agent 4 shared; Agents 1/2 domain | FAIL | HARD-A1-001, HARD-A2-009, HARD-A2-012 | NOT_RUN |
| `/settings/profile` | Agent 4 | AUDITED | Agent 4 route/procedure inventory | NOT_RUN |
| `/settings/store-groups` | Agent 4 | FAIL | HARD-A4-011 | NOT_RUN |
| `/settings/units` | Agent 2 | AUDITED | Agent 2 route inventory | NOT_RUN |
| `/settings/users` | Agent 4 | AUDITED | Agent 4 route/procedure inventory | NOT_RUN |
| `/settings/whats-new` | Agent 4 | AUDITED | Agent 4 route inventory | NOT_RUN |
| `/stores/[id]/compliance` | Agent 4 | AUDITED | Agent 4 route/procedure inventory | NOT_RUN |
| `/stores/[id]/hardware` | Agent 4 | AUDITED | Agent 4 route inventory; RBAC intent needs runtime/product confirmation | NOT_RUN |
| `/stores/new` | Agent 4 | AUDITED | Agent 4 route/procedure inventory | NOT_RUN |
| `/stores` | Agent 4 | AUDITED | Agent 4 route/procedure inventory | NOT_RUN |
| `/suppliers/new` | Agent 3 | AUDITED | Entry route inventoried in Agent 3 audit | NOT_RUN |
| `/suppliers` | Agent 3 | FAIL | HARD-A3-007, HARD-A3-019 | NOT_RUN |
| `/[locale]/[...slug]` | Agent 4 | AUDITED | Localized fallback/redirect inventoried | NOT_RUN |
| `/[locale]` | Agent 4 | AUDITED | Localized landing/redirect inventoried | NOT_RUN |
| `/c/[slug]` | Agent 3 | FAIL | HARD-A3-021–023, HARD-A3-027 | NOT_RUN |
| `/developers/bazaar-api` | Agent 3 | AUDITED | Public API documentation inventory completed | NOT_RUN |
| `/inventory/movements/[id]/print` | Agent 2 | AUDITED | Agent 2 print-route inventory | NOT_RUN |
| `/invite/[token]` | Agent 4 | AUDITED | Public/token-scoped route inventory | NOT_RUN |
| `/invite` | Agent 4 | AUDITED | Public route inventory | NOT_RUN |
| `/login` | Agent 4 | AUDITED | Public authentication route inventory | NOT_RUN |
| `/` | Agent 4 | AUDITED | Public landing route inventory | NOT_RUN |
| `/register-business/[token]` | Agent 4 | AUDITED | Public/token-scoped route inventory | NOT_RUN |
| `/reset/[token]` | Agent 4 | AUDITED | Public/token-scoped route inventory | NOT_RUN |
| `/reset` | Agent 4 | AUDITED | Public authentication route inventory | NOT_RUN |
| `/signup` | Agent 4 | AUDITED | Public authentication route inventory | NOT_RUN |
| `/verify/[token]` | Agent 4 | AUDITED | Public/token-scoped route inventory | NOT_RUN |

## Required execution dimensions

For every authenticated route above, the eventual browser matrix must record Admin, Manager, Cashier, and limited/Staff behavior where applicable; `390x844`, `414x896`, `768`, `1440`, and large-desktop layouts; light and dark themes; required data and UI states; supported actions; console/network status; and filter/back-navigation behavior.

Public/token routes use `NA` for authenticated role combinations but still require anonymous, invalid-token, expired-token, success, error, responsive, theme, and accessibility coverage.

## Non-page surfaces

HTTP APIs, tRPC procedures, background jobs, models, print/download handlers, SSE, PWA assets, and external integration entry points are inventoried in the four agent audits and linked from the master issue ledger. They require separate contract/integration matrices during implementation because treating them as page rows would hide server-only authorization and replay risks.
