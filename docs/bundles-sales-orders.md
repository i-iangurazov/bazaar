# Bundles + Sales Orders

## Catalog Representation
- Bundles are first-class catalog items in `Product` with `isBundle = true`.
- Bundle composition is stored in `ProductBundleComponent`:
  - `bundleProductId`
  - `componentProductId`
  - `componentVariantId` (optional)
  - `qty`
- Regular products keep `isBundle = false`.

## Pricing Model
- Sales line `unitPriceKgs` is always snapshotted on add:
  - store override (`StorePrice`) if present
  - otherwise product `basePriceKgs`
- This applies to both regular products and bundles.

## Cost + Profit Snapshot
- Sales line cost is snapshotted into:
  - `unitCostKgs`
  - `lineCostTotalKgs`
- Regular product line cost:
  - `ProductCost` by variant key, fallback to `BASE` when needed.
- Bundle line cost:
  - sum of component costs at add time:
  - `sum(component avgCostKgs * componentQty)`
- Metrics use snapshotted values, so historical profit is stable even when later costs change.

## Inventory Policy on Sale
- Completing a sales order creates immutable `SALE` movements.
- For bundle lines, sale is recorded against the bundle SKU itself.
- Sales completion does not explode bundle lines into component movements.
- Component consumption is handled by bundle assembly workflows.

## Current Limits
- No discount/tax split in sales lines yet.
- No FEFO component depletion on bundle sale.
- Bundle cost snapshot requires component costs to be present; otherwise line cost remains empty.
