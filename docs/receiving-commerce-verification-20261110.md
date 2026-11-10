# Receiving pricing, remaining-stock cost and transfer printing — 2026-11-10

## Scope and behaviour

The authorized scope is the customer's transfer-print video and Adik's two receiving requests. Changes target the receiving workflow and the shared movement print component; customer inventory is not reconciled or rewritten.

| Before | After |
| --- | --- |
| An empty printed comment could fall back to the journal's automatically generated product-name preview. | Print the employee's actual comment only. Keep the journal preview, document lines, quantities, signatures and genuine comments. |
| Receiving accepted quantity and purchase cost; setting a selling price required a separate product edit. | Optionally enter a new retail price for the selected store and product/variant. Apply it with receiving in one transaction. Blank preserves the price; zero is explicit. |
| No trustworthy selected-store estimate combining remaining old stock and the new receipt was shown. | Show current and projected reference cost of remaining stock from evidenced movements. Explain unavailable estimates rather than substitute a global product-card cost. |
| KGS purchase costs could be labelled with a foreign store currency. | Purchase cost, reference cost and document total explicitly use KGS. The new selling-price field uses the store currency and converts to KGS at the server-reviewed boundary. |
| A fresh retry key on every click could create another receiving after a lost successful response. | Freeze and retain the exact request before sending. Reload and explicit reconciliation recover the same operation or safely cancel its unused key. |

The customer-requested two-column operational workflow, its column proportions and product picker remain. Existing inputs, buttons, icons, subscription locks and translations are reused.

## Cost boundary

The new estimate is **reference valuation**, not a migration of financial accounting. Existing organization/product/variant `ProductCost` and receiving rules remain; historical sales and COGS are not recalculated.

For example, receive 100 units at 100 KGS, sell 90, then receive 10 at 200: remaining-stock reference cost is `(10×100 + 10×200) / 20 = 150 KGS`. The existing receipt-based product-card calculation is 109.09 KGS. The UI and guide explicitly distinguish them.

Replay handles evidenced receipts, outbound quantities, paired transfers, original-sale returns and supported corrections. Fractional valuation retains Decimal precision. Backdated receipts are projected by replaying subsequent movements; ambiguous ordering remains unavailable. Unvalued initial/import quantities, negative stock, mismatched snapshots and missing provenance produce a localized reason. A zero stock reset can restore a known state after the next valued receipt.

Reads are bounded to 50,000 movements per request and 20,000 per product/variant. Exceeding the bound yields an unavailable estimate and does not prevent receiving. No financial inference is delegated to AI.

## Transaction, access and recovery

- Fresh active user, organization, store, role, product/variant, unit precision and plan checks are enforced on the server.
- A 15-minute signed review binds the actor, exact payload, currency/rate, current prices, unit and valuation evidence. Changed evidence rejects the stale request before writing.
- Serializable execution, deterministic product locks and existing idempotency protect stock, cost, optional retail update and audit together. A final-audit failure rolls back all of them.
- Only the selected store's retail price changes. Wholesale prices and discounts remain. A shared retail price becomes a disclosed local override only after an actual change; entering the same price preserves inheritance.
- Pending browser state is scoped by organization/user/store, validated, never overwritten by a different unresolved attempt, and retained until a known outcome. Storage errors fail closed.
- Late callbacks are bound to the frozen request and authenticated owner. They cannot clear another operation or navigate a different account.
- Reconciliation can recover a committed document after subscription expiry, but cannot create stock or change prices. A canceled key blocks a late copy of the original request.
- Receiving decisions are durable: the existing 30-day response-cache cleanup retains this new route's POSTED/CANCELED keys. A 90-day recovery regression verifies that cleanup cannot turn an already saved receipt into an apparently unposted attempt. Other routes retain their existing cleanup policy.
- Post-commit notification failures cannot turn a saved receiving into a failed save. Client price caches are invalidated after successful posting.
- Historical receipt editing retains its existing business flow and does not acquire new retail-price writes.

## Verification record

All write scenarios use a disposable PostgreSQL 16 cluster on `127.0.0.1:55610` and dedicated Redis on `127.0.0.1:55611`, with synthetic data and external providers disabled. No customer database is reset, seeded or used for test transactions. No schema migration is included.

- Across the expanded and final runs, **342 distinct tests passed**, with no unresolved failures. The first expanded run had one existing POS timeout; the unchanged case passed in isolation and then with the complete POS suite in the **179/179** related run. Final hardening passed **146/146**.
- Final UI ownership/storage/panel/handoff/lifecycle checks: **44/44**. The actual workflow DOM regression covers the unstable tRPC utility-property identity that originally caused a React update loop, and restoration of an unresolved request without a perpetual spinner.
- New receiving commerce database cases: **29/29**; store valuation database cases: **8/8**.
- TypeScript, full ESLint, translation validation and final production build passed.
- Movement printing: **8 desktop/mobile states and 4 A4 PDFs**, 20 ordered lines each, no duplicate comment list or empty page. Manual comments and write-off reasons remain. Mobile horizontal document scrolling was checked.
- Browser production-build checks: **20 scenarios**, including RU/KG/EN at 1440/390 px, known/unavailable valuation, KGS/USD/GBP, tariff locks with billing links, historical editing, four actual transfer-print route states, an eight-line draft with the established 2:3 columns, and both lost-response recovery races. No runtime errors or unexpected server errors remained. Expected test-induced network aborts were classified separately.

Screenshots and PDF pages were visually inspected, in addition to assertions. Evidence is recorded in `.local/qa/receiving-commerce-20261110/`; release checks are summarized in the delivery report. Counts above overlap and must not be added together. Mobile checks use a browser viewport, not a physical iPhone.

## References used

- [ERPNext: FIFO and Moving Average](https://docs.frappe.io/erpnext/fifo-and-moving-average) — moving-average valuation of stock.
- [Lightspeed: Editing prices on received products](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534177672603-Editing-prices-on-received-products) — explicit pricing while processing receipts, with location-specific prices.
- [Lightspeed: Price Books and retail-price changes](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25533891778715-Will-Price-Books-adjust-when-the-Retail-Price-of-Products-is-changed) — distinguish specific price rules from default retail price.

These are design references. Bazaar's existing accounting and store-price contracts govern the implementation; no upstream source code was copied.
