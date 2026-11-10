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

## CI follow-up and dependency scan boundary

Run `42789474837` for `c4951974` exposed two separate CI failures: the workflow DOM test used an unsupported `exact` option on Testing Library's role query, and `reporting-browser` could not bind host port 55440 during container initialization, before checkout. The former needs its type correction; the latter is an infrastructure startup failure and produced no application test result. No service port is changed in this correction.

The apparent green `dependency-security / osv-scan` was invalid evidence. Its log shows an unsupported `--ignore-vuln` flag, scanner exit 127 and a reporter error opening the missing `results.json`, followed by an empty SARIF upload. The original upstream reusable workflow continues after scanner errors. The corrected job uses the same pinned official v2.3.0 scanner/reporter actions, supported `--config=osv-scanner.toml`, and `--all-packages`. Before reporting it requires valid JSON containing the scanned, nonempty `pnpm-lock.yaml` inventory. A clean scan has packages without vulnerability entries; missing/empty output cannot masquerade as a clean scan. Reporting still uses `--fail-on-vuln=true`; JSON and SARIF are retained as artifacts.

Exactly the four pre-existing advisory exclusions are preserved, with provenance from `275ef784` in the configuration. That original commit and the existing security notes recorded no applicability rationale. This repair neither adds exclusions nor labels those advisories harmless.

The official prebuilt **OSV-Scanner 2.3.0** (SHA256 checked against its release checksums) was run against the actual lockfile with the same configuration. It scanned **1,346 package versions** and returned exit **1**, identifying **128 distinct advisory IDs across 47 package versions** after the existing exclusions. These are dependency advisory matches, not 128 demonstrated exploitable paths in Bazaar. Complete JSON, compact summaries and scanner logs are in `.local/qa/receiving-commerce-20261110/security/`. The dependency gate must remain red while unresolved findings remain; successful receiving checks do not waive it.

Verification of the failure boundary:

- **10/10** offline tests execute the actual workflow JSON gate: clean inventory and genuine findings pass to the reporter; missing, blank, truncated, error-only, wrong-lockfile, empty-inventory and malformed-inventory outputs fail.
- A real clean one-package synthetic lockfile scanned with the same binary returned **0** and passed the gate.
- The real Bazaar findings JSON passes inventory validation and retains scanner exit **1** for the vulnerability-reporting stage.
- A deliberately invalid TOML configuration returned **127**, produced zero JSON bytes and failed the actual gate. This reproduces and closes the original false-green path.

### Separate dependency remediation plan

No dependency versions are changed by this receiving/CI correction. A controlled follow-up should prioritize the following groups, then repeat the complete dependency scan and existing regression gates:

| Group | Current scanned versions | Candidate fixed branch and required verification |
| --- | --- | --- |
| Next.js / image processing | Next 14.2.35; sharp 0.32.6 / 0.34.5 | Evaluate Next **15.5.28 or later patched 15.x** and the sharp actually resolved by its image optimizer. This is a framework migration: verify auth, async request APIs, routes, caching, images, builds and worker/native contracts. |
| Native Android / iOS | Capacitor 8.5.0 | **8.5.1 or later patched 8.x**; align platform/core packages, rebuild both native applications and verify navigation, links, HTTP and plugins. Installing an npm update alone does not update distributed native binaries. |
| Authentication and translations | next-auth 4.24.13; next-intl 3.26.5 | Feed candidates: next-auth **4.24.15**; next-intl **4.9.2**. Translation upgrade crosses a major and must be checked with the chosen Next branch and all locales. |
| Validation | Zod 3.25.76 / 4.1.11 | Feed candidate: **4.6.6**. Inventory Zod 3 callers, tRPC/resolver compatibility, parsing/error behavior and public schemas before migrating; do not blindly override the transitive major. |
| Test tooling | Vitest / mocker 2.1.9; Vite 5.4.21 | Feed candidate: **Vitest 4.1.11** plus a compatible patched Vite branch. Verify mocking, environment setup, database isolation, browser tooling and all tests. |
| Remaining direct/transitive packages | ws 8.20.0, fast-xml-parser 5.3.4 and other reported package versions | Feed candidates include ws **8.21.0** and fast-xml-parser **5.7.0**. Update the owning dependency where possible, remove stale duplicate resolutions, and rescan; the complete per-advisory fixed-version list is in `security/upgrade-candidates.json`. |

Two critical entries were checked against upstream maintainer advisories, beyond the aggregated feed:

- [Next.js GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw): affected range includes 14.2.35; patched versions are 15.5.28 / 16.4.1. The maintainer describes an image-processing issue on glibc Linux and a sharp >= 0.35.5 workaround. Bazaar's actual deployed image-processing path and platform conditions still require applicability verification; no exploit was attempted.
- [Capacitor GHSA-rvm3-566m-v7fv](https://github.com/ionic-team/capacitor/security/advisories/GHSA-rvm3-566m-v7fv): 8.5.0 is affected and 8.5.1 patched. The issue concerns a user-activated WebView link to an internal proxy path; disabling CapacitorHttp alone is insufficient. Native reachability and shipped build versions require verification; this is not a claim that Bazaar has been compromised.

The other upgrade numbers are candidates derived from the recorded OSV advisory ranges, pending compatibility and maintainer-release verification. They are not an approved bulk-upgrade instruction.

Official OSV references: [v2.3.0 configuration](https://github.com/google/osv-scanner/blob/v2.3.0/docs/configuration.md), [v2.3.0 result model](https://github.com/google/osv-scanner/blob/v2.3.0/pkg/models/results.go), [upstream reusable workflow and its continuation behavior](https://github.com/google/osv-scanner-action/blob/v2.3.0/.github/workflows/osv-scanner-reusable.yml).

## References used

- [ERPNext: FIFO and Moving Average](https://docs.frappe.io/erpnext/fifo-and-moving-average) — moving-average valuation of stock.
- [Lightspeed: Editing prices on received products](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534177672603-Editing-prices-on-received-products) — explicit pricing while processing receipts, with location-specific prices.
- [Lightspeed: Price Books and retail-price changes](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25533891778715-Will-Price-Books-adjust-when-the-Retail-Price-of-Products-is-changed) — distinguish specific price rules from default retail price.

These are design references. Bazaar's existing accounting and store-price contracts govern the implementation; no upstream source code was copied.
