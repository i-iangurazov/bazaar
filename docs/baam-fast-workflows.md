# BAAM fast workflows

Baseline: `48e25989905f251c839c144ed241612ae5db46d8`. Changes concern BAAM, its existing business adapters and additive conversation storage. Sales may still make stock negative. Zero purchase cost remains valid. ADMIN/MANAGER access and the exact `/pos/sell` exclusion are unchanged.

## Measured causes

The old server sent 54 tool definitions, 40 messages, 12 actions and attachment references. Serial model calls performed lookup, prepared an action, then called the model again to phrase a response. Payloads were 46–62 KB per round. Typical operations took 2–4 model calls; DB work itself took about 0.1–0.3 seconds. Browser polling every 1.2 seconds produced 27–41 backend requests per response.

The new server recognizes conservative complete commands (including separate help, negation and correction cases), or asks the same configured model once for a strict intent/field structure. It sends one small tool, at most four related user messages and the active form. Unknown/ambiguous intent produces choices. It never uses model arithmetic or generated success claims. Date context uses the existing Asia/Bishkek business-day convention; unclear report dates require clarification.

Forms, reference lookup, selection, photo preparation/upload, field validation, saving, confirmation and standard results use no model. They work without an AI key. The model is needed for arbitrary phrasing and ASR retains its separate existing provider. The response includes current conversation state, eliminating a follow-up fetch; polling is slower and bounded to conversation state. No inventory/report result cache was introduced.

## Comparable local measurements

Same existing `gpt-5-mini`, database fixture, machine and two sequential repetitions. Times include creating and reading the conversation; actual provider calls use the configured server key. First/repeated here describe sequence, not a claim of a forced cold cloud function. Source evidence is in ignored `tmp/baam-fast/baseline-results.json` and `final-results.json`.

| Request | Before, ms (first / repeated) | After, ms (first / repeated) | Model calls before → after | Useful outcome after |
| --- | ---: | ---: | --- | --- |
| Create product, no parameters | 31,654 / 37,219 | 80 / 51 | 2 → 0 | One editable form |
| Complete quoted product request, price and zero cost | 25,636 / 29,720 | 104 / 98 | 3 → 0 | Real product and link |
| Sales today | 21,470 / 23,933 | 47 / 38 | 2 → 0 | Actual report values |
| Free-form sale request for two units | 38,365 / 37,142 | 3,200 / 2,354 | 4 → 1 | Real unpaid receipt |
| Free-form receiving request | 27,878 / 31,105 | 4,603 / 2,288 | 3 → 1 | Prefilled receiving form |

Baseline browser requests took 27.8–44.7 seconds. Buttons in the built application opened real server forms in 207–226 ms. These are local measurements, not a production latency SLA. Standard form execution never invokes the model. `baam.request` and `baam.intent` logs record duration, request/turn identity, model-call count and bounded payload size, without keys or image content.

## Capability matrix

All 49 existing write adapters have server-generated field metadata and localized RU/EN/KG controls. The menu exposes only the actor's adapters; actual services recheck role, organization and store. Required parameters below are summaries; the action schema and normal service remain authoritative. Optional normal-process fields are not made mandatory by BAAM.

| Action group | Existing API/service | Required data / form | Result | AI required |
| --- | --- | --- | --- | --- |
| Product create/update/assign store | `products.create/update`, store assignment adapter | Name and unit for creation; existing product for update; store/products for assignment. Optional photo, prices, variants, attributes, packaging | Actual product/detail link; photo update targets the created product | No for menu/forms; at most one for free text |
| Receiving | `inventory.postStockReceiving` | Store; product/variant, positive base quantity, nonnegative unit cost per row. Supplier/reference/note optional | Posted receiving document and edit/detail link | Same |
| Signed/absolute stock adjustment, write-off, transfer | Existing inventory mutations | Exact product/store, quantity or signed delta; reason; destination and rows for transfer | Normal movements and inventory history; existing version conflict checks | Same |
| Supplier/customer create/update | Existing contacts routers | Name; scoped existing record for update; customer store. Optional contacts | Saved contact/list link | Same |
| Purchase create/submit/approve/cancel/receive/partial receive and line add/update/remove | Purchase-order router | Supplier/store/rows for draft; existing document/lines and selected quantities for later steps | Actual purchase status/document; existing on-order and stock rules | Same |
| Customer order create/confirm/ready/complete/cancel and line add/update/remove | Sales-order router | Store/products/quantities or selected order/line | Actual order/status/link | Same |
| POS prepare/complete/hold/resume/cancel and line add/update/remove | POS sales router | Open register; products/quantities. Existing receipt and one payment form for completion | Real unpaid receipt, held/cancelled status or completed sale/number/link. Draft creation is never called a paid sale | Same |
| Open shift | POS shifts router | Register and opening cash | Actual open shift | Same |
| Stock count create/set/remove/apply/cancel | Stock-count router | Store or exact count/product/line and count quantity | Actual count and ordinary apply process | Same |
| Return prepare/complete/cancel and line add/update/remove | POS returns router | Open shift, original receipt/line, quantity; refund method for completion | Actual return through existing stock/payment rules | Same |
| Product/stock search | Existing bounded search and inspect | Product name/SKU; scoped store if selected | Actual product links and physical snapshot quantities; missing snapshots explicitly differ from zero | No for exact command; one for arbitrary wording |
| Sales report | `getBaamSalesMetrics` | Store scope, inclusive date range | Completed POS receipts/returns, average receipt, net sales; matching report link | No for known periods; one for arbitrary wording |
| Navigation/explanations | Existing localized help catalog | Current page or guide | Published instructions and working app links | No for menu/help shortcut; one to identify arbitrary request |
| Other financial/production/integration operations without an adapter | Existing normal application | No speculative execution | Honest help/navigation handoff | No fabricated data/action |

The new form layer has no financial or warehouse implementation. Generic schemas/labels are checked against the entire existing registry; business integration coverage remains in the original companion/execution suites. New browser coverage concentrates on the changed product, photo, receiving and POS paths, not a claim of manually running every adapter in every role/device.

## State and execution guarantees

`BaamWorkflow` stores editable parameters, field presentation, scope revision, status and actual resource/result. A conversation points to its active workflow; superseded/cancelled cards cannot submit. Autosave uses optimistic revisions and preserves failed input locally. A scope change invalidates previous forms. History remains scoped to user and organization.

Each submitted form owns a UUID `BaamWorkflowRequest`, payload hash and lease. Before execution, it stores an immutable `BaamAction`; the existing `BaamExecution` transaction receipts, fencing and auditing handle actual changes. A repeated request recovers that same action. Committed partial work remains linked and cannot be recreated by a new form request. An uncertain request blocks unrelated actions until its result is recovered. Payment execution compares the displayed receipt fingerprint, including exact lines and prices, with current server state; changed receipts require explicit refresh.

## Photo defect and fix

Production reproduction established two concrete defects: a valid 3,637,610-byte PNG received HTTP 413 with `baamAudioTooLarge`; an unreadable HEIC received generic `baamMediaFailed` because the route discarded ordinary storage/decoder errors. A small PNG uploaded to R2 successfully, so this was not evidence that production storage itself was down.

BAAM now uses the existing product-image preparation/compression pipeline (32 MB input allowance, 3 MB prepared upload), before multipart upload. It shows a preview, actual upload progress, replacement/removal, specific decoding/size errors and retry; other fields remain intact. Upload uses no model. Attachments are deduplicated by conversation/content hash. Existing product results offer a photo update to that resource, not a second product creation. Audio retains its own limits and processing.

## Verification and release

- Final local full suite: 2,081 tests in 295 files; typecheck, lint, i18n and production build passed. Four-role browser route/history/focus checks and workflow capture passed.
- Added unit coverage for conservative RU/EN/KG intent routing, negations/help, corrections, complete zero-cost phrases, complete adapter/label coverage, safe form paths and business-day boundaries.
- New DB tests cover persisted invalid input, zero-model creation, same-UUID concurrency/replay, stale tabs, other users/roles/organizations, superseded forms, multi-line zero-cost receiving, held/resumed/cancelled/completed receipts, negative stock and altered-cart rejection/refresh.
- `scripts/baam/fast-capture.ts` runs after the existing browser suite in CI. It checks actual forms, oversized-photo preparation, failed-upload retry, reload persistence, lost response after commit with no duplicate product, photo attachment to an existing product after a concurrent edit and explicit refresh, two-line receiving, a 350 KGS sale and exact stock, plus desktop/mobile RU/EN/KG screenshots.
- Existing real human RU/EN/KG recordings were reprocessed. Actual Chromium MediaRecorder → upload → ASR → editable transcription passed. The mixed sample concatenates separate corpus clips; it is not a natural mixed conversation. No physical phone/microphone test is claimed.
- Migration `20260911001500_baam_workflows` is additive and approved by exact checksum in the established deployment guard. No stock, sales, payments or historical business rows are rewritten.

Local evidence is not production verification. Final SHA, CI, production promotion, migration ledger and deployed smoke results are checked separately for the actual release.
