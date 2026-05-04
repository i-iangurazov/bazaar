# UI Color Semantics

## Principle

Bazaar should feel calm, structured, and merchant-focused. Most UI should be neutral. Color is reserved for meaning: action, selection, focus, status, urgency, and confirmation.

## Rules

- Neutral: default surfaces, cards, tables, forms, empty states, secondary buttons, inactive navigation, and most badges.
- Brand blue: primary CTA, active navigation, selected/focused controls, and links. Do not use blue as decoration in KPI cards.
- Critical red: destructive actions, blocking errors, negative stock, and sale-blocking missing data. In tables, red should be subtle by default, not a solid alarm block.
- Warning orange: needs-attention states such as low stock, expiring stock, pending work, or missing recommended data. Use subtle badges and restrained text color.
- Success green: completed/success confirmation only. Avoid green KPI icons or decorative dashboard accents.
- Info blue: tips/help/informational affordances only, with low prominence.

## Applied In This Slice

- `Badge` now renders neutral/subtle by default. `warning`, `danger`, and `success` use light backgrounds, borders, and semantic text instead of solid fills.
- Dashboard KPI cards are neutral and no longer show decorative colored icons.
- Dashboard "Needs attention" counts use muted badges when counts are zero and subtle semantic badges only when there is something to handle.
- Product list uses one readiness badge per row: ready, missing price, missing barcode, missing stock, or negative stock.
- Product price and barcode columns no longer repeat loud missing-data badges when readiness already communicates the issue.
- Inventory summary cards are neutral; only non-zero critical/warning values receive semantic text color.
- Low stock uses warning treatment. Negative stock remains critical.

## Do Not Reintroduce

- Solid red/orange/green badges in dense tables unless the state blocks work and needs immediate escalation.
- Green dashboard icons for normal positive metrics.
- Multiple badges repeating the same issue in one product row.
- Colorful icons on every KPI card.
- Multiple blue primary actions in the same header or toolbar.
