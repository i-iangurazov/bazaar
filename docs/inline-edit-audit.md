# Inline Edit Audit

Date: 2026-02-20

## Enabled inline tables

| Table | Editable column | Mutation route | Server RBAC | Notes |
| --- | --- | --- | --- | --- |
| Products list | `name` | `products.inlineUpdate` | `ADMIN` | Uses existing `updateProduct` service validation. |
| Products list | `category` | `products.bulkUpdateCategory` | `ADMIN` | Single-row inline uses bulk endpoint with one `productId`. |
| Products list | `salePrice` (no store selected) | `products.inlineUpdate` | `ADMIN` | Writes base product price. |
| Products list | `salePrice` (store selected) | `storePrices.upsert` | `MANAGER`, `ADMIN` | Writes store override price. |
| Products list | `onHandQty` (when store selected) | `inventory.adjust` | `MANAGER`, `ADMIN` | Inline absolute value is converted to delta (`qtyDelta`) using existing inventory adjustment flow. |
| Inventory list | `minStock` | `inventory.setMinStock` | `MANAGER`, `ADMIN` | Store-scoped and org-scoped server-side. |
| Suppliers list | `name` | `suppliers.update` | `MANAGER`, `ADMIN` | Full supplier update with current row values. |
| Suppliers list | `email` | `suppliers.update` | `MANAGER`, `ADMIN` | Full supplier update with current row values. |
| Suppliers list | `phone` | `suppliers.update` | `MANAGER`, `ADMIN` | Full supplier update with current row values. |
| Suppliers list | `notes` | `suppliers.update` | `MANAGER`, `ADMIN` | Full supplier update with current row values. |
| Stores list | `name` | `stores.update` | `MANAGER`, `ADMIN` | Existing store update flow. |
| Stores list | `code` | `stores.update` | `MANAGER`, `ADMIN` | Existing store update flow. |
| Stores list | `allowNegativeStock` | `stores.updatePolicy` | `MANAGER`, `ADMIN` | Policy endpoint already scoped and validated. |
| Stores list | `trackExpiryLots` | `stores.updatePolicy` | `MANAGER`, `ADMIN` | Policy endpoint already scoped and validated. |
| Stores list | `legalEntityType` | `stores.updateLegalDetails` | `ADMIN` | Legal details are admin-only. |
| Stores list | `inn` | `stores.updateLegalDetails` | `ADMIN` | Existing INN validation reused server-side. |
| Users list | `name` | `users.update` | `ADMIN` | Existing users update validation reused. |
| Users list | `email` | `users.update` | `ADMIN` | Existing users update validation reused. |
| Users list | `role` | `users.update` | `ADMIN` | Existing users update validation reused. |
| Users list | `preferredLocale` | `users.update` | `ADMIN` | Existing locale validation reused. |
| Users list | `isActive` | `users.setActive` | `ADMIN` | UI blocks self-toggle; server also enforces self-protection. |
| Units list | `labelRu` | `units.update` | `ADMIN` | Existing unit update validation reused. |
| Units list | `labelKg` | `units.update` | `ADMIN` | Existing unit update validation reused. |

## Form/action-only tables (not inline)

| Table | Current edit path | Why inline is not enabled |
| --- | --- | --- |
| Purchase orders list | Row actions (`cancel`) and detail page workflows | Status transitions are workflow/state-machine actions, not safe free-form cell edits. |
| Sales orders list | Row actions (`complete`, `cancel`) and detail page workflows | Status transitions are workflow/state-machine actions, not safe free-form cell edits. |
| Inventory counts list/detail | Dialogs + actions (`setLineCountedQty`, apply/cancel) | Counting workflow requires explicit action steps. |
| Attributes table (`settings/attributes`) | Modal form using `attributes.update` | Endpoint requires full definition payload (`key/type/options/required`), no safe minimal patch endpoint for single-cell updates. |
| Category template mapping table | Actions (`categoryTemplates.set/remove`) | Order/template edits are batch semantics, not single-cell updates. |
| Product detail store grid | Per-row input + explicit save (`storePrices.upsert`, `inventory.adjust`) | Already has dedicated inline-like controls; stock adjustment requires reason/audit semantics. |
| Admin jobs | Row actions (`retry`, `resolve`) | Action-based operational control, no editable data cells. |
| Platform owner tables | Row actions + modal update (`reviewUpgradeRequest`, `updateOrganizationBilling`) | Financial/subscription edits remain explicit action/modal flows. |
| Reports / exports / close / import history tables | Read-only or action-only | No editable data cells. |

## Gaps and minimal endpoint proposals

1. Attributes table inline labels/required:
   - Gap: no safe single-field patch endpoint; `attributes.update` requires full object and options coherence.
   - Minimal endpoint proposal: `attributes.inlinePatch` with input `{ id, patch: { labelRu?, labelKg?, required? } }`, admin-only, org-scoped, with audit log.
2. Store legal details table columns not shown in list (`legalName`, `address`, `phone`):
   - Gap: currently editable via modal only.
   - Endpoint status: safe endpoint already exists (`stores.updateLegalDetails`), so this is UI scope, not backend gap.
