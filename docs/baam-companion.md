# BAAM companion: capability and verification matrix

## DeepSeek upgrade on playground, 2026-10-22

Current implementation: `codex/playground`. This is a branch delivery; neither `main` nor production is deployed by this change. Verification details and commands are recorded in `ai-upgrade-verification-2026-10-22.json` after the final checks.

### What is enabled and which provider executes it

| Capability | Current behavior | Executor |
| --- | --- | --- |
| Free-form BAAM questions, task extraction, corrections and explanations | One bounded interpretation contract with localized metadata for all 49 existing operations. General questions receive an actual explanation; named existing records use their update operation. Missing values open the ordinary form. | DeepSeek Flash by default when its server key is present |
| Sales analysis in the current chat | Summaries, comparison with an equal preceding period, receipts, average receipt, returns, discounts, payment reconciliation and diagnostics. Scope-only follow-ups retain authenticated context. | DeepSeek selects references when needed; server reads, computes and renders every business figure |
| Product analysis | Top/bottom up to 50 products, net line revenue, net quantity, most-returned quantity, zero qualifying sales, product search/details/performance. Digits and spoken RU/EN/KG counts are supported. | Conservative local parsing and DeepSeek; PostgreSQL aggregates |
| Customers, suppliers and operational documents | Bounded authorized record cards for customers, suppliers, orders, purchases, receipts, returns, counts and stores. Document/customer links open the actual record; supplier links filter the actual directory. | Existing business readers; no database results are sent to the text model |
| Photos in BAAM | Reads the visible image and legible text from owned conversation attachments. Image instructions are untrusted; reading a photo does not authorize an action. Image-derived values require review. | DeepSeek Flash vision |
| Product descriptions | Existing single and bulk/job flows remain; RU/EN/KG output and existing validation/retries are retained. | DeepSeek vision/text |
| Suggested product characteristics | Uses actual photos; uncertain material/other attributes may remain absent. | DeepSeek vision |
| AI clothing category arrangement | Enabled by default. Existing clear rules remain local; uncertain photos/text go to DeepSeek. Existing categories and confidence threshold remain authoritative; ambiguous/unisex/kids items can be skipped. Locally managed product photos now reach the model as prepared image data. | Local rules plus DeepSeek vision |
| Product image studio | The disabled/Soon overlay and integration-card block are removed. Actual upload, job, retry, preview and explicit save flows remain. Fixed unsupported high-fidelity setting for the mini image model. | Existing OpenAI image executor |
| Speech input | Existing real transcription, language handling, editable review, ownership and duration limits remain. A synthetic spoken business query was also exercised through transcription into a real report. | Existing OpenAI ASR, followed by BAAM |
| Read answer aloud | Optional user-triggered play/stop, language-aware voice selection and cancellation. Voice availability depends on the device, especially Kyrgyz. | Browser speech synthesis |
| Inventory forecasts/reordering and financial calculations | Existing deterministic algorithms remain authoritative. They are not relabelled as generated DeepSeek figures. | Existing server services |

`AI_PROVIDER=auto` prefers `DEEPSEEK_API_KEY`; explicit `deepseek` fails closed when its key is absent. Existing OpenAI-only installations retain their compatibility path. `DEEPSEEK_MODEL` defaults to `deepseek-flash`; BAAM and vision have optional dedicated overrides. Vision requires an image-capable model. Keys remain server-only and are not committed. Automated preview/test environments strip both providers' credentials; live acceptance is explicitly opt-in and restricted to the named disposable BAAM database and synthetic organization.

### Useful answers and voice workflow

Sales answers contain metric cards, exact business dates/timezone, store scope, comparison values, source rules and a matching report link. Product and document cards show recorded fields and application links. Long explanations support paragraphs, numbered steps, emphasis and code without rendering provider HTML or external destinations. Only separately server-supplied app links can become clickable. Empty results, invalid/incomplete provider output and retry are distinct states.

The user can correct the current form by voice/text. An explicit **«Подтверждаю выполнение»**, **“Confirm execution”**, or **«Аткарууну ырастайм»** confirms a complete current form through the normal fenced/idempotent workflow submission. Missing fields and unresolved choices remain for review; already executed operations are not repeated. A bare “yes” is not execution authorization. Voice transcription still offers editable review; this is not a promise of continuously listening or reliable speech recognition in every acoustic environment.

Before a chat command, the page and header drawer flush pending form edits through the existing revision-checked save queue. A failed save blocks the command; a just-edited quantity cannot be confirmed against an older persisted form. The customer-create adapter also checks the existing business requirement for at least a phone or email before automatic execution. Missing contact details stay in review instead of producing a preventable failed creation.

Common date wording now includes today/yesterday, current month, current week, a trailing week, complete preceding periods, ISO dates, `DD.MM.YYYY` and a shared named-month range such as «с 1 по 15 октября 2026». Invalid or ambiguous dates require clarification. «За месяц» means the current month to date and «за неделю» means seven days through today; the exact dates are visible. The corrected raw SQL compares UTC timestamps explicitly, independently of the PostgreSQL session timezone. Boundary checks cover both UTC and Asia/Bishkek.

### Independent acceptance scenarios

The human-authored corpus is in `scripts/baam/acceptance-cases.ts`: 36 broad multilingual scenarios plus a separate phrase for every one of the 49 write adapters. It covers comparisons, zero sales, returned products, reconciliation, follow-ups, invalid spoken dates, customer/order lookup, purchases, counts, negations, how-to, greetings, mixed-language speech, zero cost, edits, cancel, multiple unrelated writes, unavailable stores and unsupported profit/tax requests. The separate action corpus checks existing records and every document lifecycle/line operation, not just the two initial top-N/date examples.

Actual business integration tests cover server figures, store/tenant boundaries, plan gates, zero cost, returns ranking, midnight boundaries, duplicate requests and voice/text confirmation. Live-provider classification tests verify understanding, not a claim that each of 49 operations was manually conducted on every device/role. The existing business/execution/workflow suites remain responsible for transactional effects and authorization. Desktop/mobile browser evidence includes metric cards, ranking links, empty results, linked instructions and the enabled studio. Synthetic voice fixtures and actual retouch output are separate evidence.

### Deliberate limits

BAAM remains ADMIN/MANAGER only. Plan gates and store grants remain server-enforced: ordinary product lookup is available without granting locked analytics. Search results are bounded to 20 records and product rankings to 50. The model cannot bypass permissions, establish payment success, calculate authoritative balances/profit/taxes, invent stock or execute an unsupported business operation. Multi-step unrelated writes are clarified instead of silently dropping steps. Photo/ASR quality and provider availability are fallible; failures retain retry/review. These boundaries are part of the delivered behavior, not disabled placeholders.

The image studio and ASR do **not** run on DeepSeek. DeepSeek's supported vision input and text output do not replace an image-editing or transcription executor. The current provider contracts are documented in [DeepSeek Responses](https://api-docs.deepseek.com/guides/responses_api/), [DeepSeek vision](https://api-docs.deepseek.com/guides/vision/) and [OpenAI image generation](https://developers.openai.com/api/docs/guides/tools-image-generation).

This is the original companion release record. The current header launcher supersedes its floating-launcher description. For the current deterministic workflows, latency measurements and photo fixes, see [BAAM fast workflows](baam-fast-workflows.md).

Baseline: `4556bee5bf870a9f7ca29412005595bf006f0060` (main). Release evidence is recorded against the final SHA by CI and `scripts/baam/production-smoke.ts`; a local result is not a production claim.

## Confirmed causes and implementation

The previous launcher excluded POS, Inventory and finance routes. POS selling returned before mounting its provider. Positioning scanned table controls, moving the button into content. The old conversation lived only in React memory and supported read-only analytics.

The launcher now has one body portal, an explicit fixed-bar obstacle contract and mobile safe-area positioning. A second first-click defect was reproduced: when NextAuth resolved, changing the provider wrapper remounted the open launcher. The provider tree now stays stable during session resolution; a regression test preserves an early interaction. Role access remains ADMIN/MANAGER, including server-side fresh membership checks. STAFF/CASHIER cannot use the API by knowing IDs.

The panel provides page suggestions, editable text/audio transcripts, photo upload, server history, new/rename/delete dialogs, explicit store selection, action/result cards, errors, cancellation and retry. Scrolling follows new requests but preserves the position of someone reading earlier messages. History loads 40 messages and 30 conversations per page. Outboxes retain UUIDs across drawer close/reload; different conversations have separate pending requests and execution state. Late replies cannot clear a different dialog's draft.

## Action matrix

Every row below uses the existing router/service, validation, permissions and domain transaction. `src/server/services/baamBusiness.ts` is the typed registry (49 actions); `baamReadTools.ts` provides bounded scoped search, inspection, actual sales reports and localized help. Tools are server internals, never UI labels.

| Area / actions | Existing mechanism and semantics | Verification |
| --- | --- | --- |
| Product create, update, assign store | Products router; real unit/variant/store references; owned photos; preserve unspecified fields; initial stock remains ADMIN-only | DB: manager create, variants append, store assignment, update preservation and conflict, zero opening/cost, replay. Browser: real provider creates products both with an uploaded PNG and without photo; ordinary product detail exists |
| Stock receive, signed adjustment, absolute set, write-off, transfer | Inventory router; normal movement documents and valuation; integer base quantities; zero cost preserved; set snapshots quantity **and version** | DB: multiline receiving, zero cost, both stores in transfer, signed delta, absolute set/no-op, stale set after concurrent adjustment; normal stock tests also run |
| Purchase create, submit, approve, cancel, receive, receive selected lines; add/update/remove draft line | Purchases router; normal on-order/status accounting; preserve omitted cost; no over-receipt | DB: draft edits → submit → approve → partial receipt 2 → full receipt 6; cancellation clears outstanding on-order |
| Customer order create, confirm, ready, complete, cancel; add/update/remove line | Sales orders router; separate from POS; normal status/stock/email policies | DB: draft edits and all transitions; actual resulting stock; ordinary order/email/POS-boundary regression |
| POS create draft, add/update/remove line, hold/resume/cancel draft, complete, open shift | POS router; explicit open register; never silently reuse an existing active cart; exact reviewed lines/prices and totals at checkout | DB: edits, hold/resume/cancel, equal-total product replacement conflict, negative stock, duplicate completion gives one payment. Browser: actual provider prepares and completes a cash sale on `/pos/sell` |
| Return create draft, add/update/remove line, complete, cancel draft | POS returns; original receipt lines and open shift; normal refund/stock transactions | DB: partial return and duplicate completion; line edits/removal/re-add/cancel produce no refund or stock restoration |
| Count create, set counted quantity, remove line, apply, cancel | Stock-count service; added missing document audit records; normal discrepancy application | DB: receipt of 10, count 8, intervening receipt +3, apply discrepancy −2 gives 11; remove/cancel leaves stock unchanged |
| Customer and supplier create/update | Existing contact routers; normalization and identity checks | DB: real records, partial update preservation, concurrent version conflict and replay |
| Read/search/inspect | Products, stores, units, attributes, suppliers, customers, registers, sales, orders, purchases, counts, returns, stock and shift report | DB: another organization and revoked store denied; bounded pages, actual IDs and current values; entitlement checks |
| Business reports | Existing BAAM metrics; explicit date interval in Asia/Bishkek and authorized stores | Existing metrics/intent/report tests retained; report links use the validated period/store; absence of receipts differs from zero |
| Navigation and guidance | Existing localized help catalog and allowlisted app links | RU/EN/KG interface copy, typed help guide IDs; only supported application destinations render |

Operations without an adapter receive an honest explanation and a link to their existing interface: bulk import/rollback, completed-document editing/archiving, stock-document editing, assembly/disassembly, advanced discounts/debt/cash reconciliation, shift closing, finance and integration configuration. BAAM does not claim to execute those workflows. No separate workshop subsystem was found in the root router; existing stock assembly remains an inventory-interface handoff. This release does not grant a manager administrator-only rights or change zero-cost/negative POS stock rules.

## Durable execution and security

Seven additive tables store owned conversations, ordered messages, turns, immutable prepared actions, per-step execution receipts, attachments and transcriptions. No pre-existing business table/index is dropped or renamed by the migration. Its reviewed SHA-256 is registered in the normal production migration guard.

A write is prepared with real server-resolved records, then displayed once for review. Nothing is reported completed until the domain transaction confirms it. Each domain step has a durable identity and fingerprint. The existing audit writer records the execution receipt in **the same transaction** as the domain mutation. A competing transaction for the same step rolls back, including its audit. Recovery returns committed resources and skips successful steps in a partial workflow. A newer attempt token fences a delayed old worker. Uncertain results are marked for review, not blindly replayed.

Role, active membership, organization, store access, conversation ownership/revision and immutable reviewed versions are checked again at commit. Historical all-store conversations retain their store scope; revoking any participating store hides their history. Page context is a hint, not authorization. Model arguments use strict Zod validation. Product/document/help text cannot override system instructions. Cross-dialog attachments/transcriptions are rejected.

Turns serialize per conversation; UUID retries return the existing result, while reusing a UUID with changed contents conflicts. Cancellation persists immediately, invalidates unexecuted proposals and differs from reversing a completed sale. Stale turns expire; stale action recovery uses persisted receipts. Multiple independent dialogs can progress without moving results into the wrong dialog.

## Voice evidence and limits

`MediaRecorder` requests the microphone, indicates duration, supports stop/discard and retries, and cleans up tracks and late permission grants. Permission requests time out visibly. Text remains available. Uploads are authenticated, rate limited and bounded even without Content-Length. The server validates actual codec/duration (up to 90 seconds / 3 MiB), including Chromium WebM with unknown-size clusters. No source audio is saved; provider multipart data is transient. History keeps the original transcript and user-edited message. Unused transcripts have a 24-hour usability deadline; used transcripts remain part of history.

The configured OpenAI account was exercised with `gpt-transcribe`, using automatic language detection. The live endpoint rejected an explicit `ky` language hint, while actual Kyrgyz audio transcribed using automatic detection. This is why a language selector alone is not used as evidence. Every transcript asks the user to review names, quantities and sums before continuing.

Eight **human** public-corpus recordings were sent through the actual backend/provider: three Kyrgyz (FLEURS derivative), three Russian (Golos), two English (LibriSpeech). Sources and reference/recognized text are retained in ignored `artifacts/baam-companion/voice/voice-reference.json` and `voice-results.json`. RU included “sixty thousand tenge” and green apples; numbers were recognized correctly. EN excerpts were accurate. Kyrgyz had occasional word/morphology errors (e.g. `сымал` / `сыямал`, `көзөмөлдөнө` / `көзөмөлдөй`), so this is **not** a claim of error-free business dictation.

A real human Russian sample also passed the full browser MediaRecorder → WebM → authenticated upload → actual ASR → editable transcript path. This host's audio device clock freezes, so a WebCodecs audio track supplied the public PCM recording to the actual recorder. This checks browser recording/codec/upload behavior, not a physical microphone or phone. Permission denial, missing device, timeout/late grant, discard and retry have hook regressions.

Additional mixed RU/EN/KG corpus concatenation was prepared, but automatic approval review rejected sending that file to ASR even after its public provenance was documented. It has **not** been verified. Natural mixed speech with local store/product names and real physical iOS/Android microphones remain unverified. Do not replace those limits with desktop emulation claims.

Provider references: [function calling](https://developers.openai.com/api/docs/guides/function-calling), [transcription](https://developers.openai.com/api/docs/guides/speech-to-text). Public audio sources: [Kyrgyz corpus](https://huggingface.co/datasets/shunyalabs/kyrgyz-speech-dataset), [Golos](https://huggingface.co/datasets/bond005/sberdevices_golos_10h_crowd), [LibriSpeech sample](https://huggingface.co/datasets/hf-internal-testing/librispeech_asr_dummy).

## Reproduction and release

- Dedicated local Postgres database: `bazaar_hardening_baam` on port 55440; separate integration database `bazaar_hardening_baam_tests`. Redis on 56390. Scripts validate those targets and disable external payments/mail/fiscal/integration effects. Seed accepts an empty database only.
- `scripts/baam/run.ts`: clean migrations/seed and deterministic role/layout browser smoke, used by required `baam-browser` CI job. Four roles, POS/Inventory/Products/workspace, 360/390/768/1440, focus and overflow assertions; localized EN/KG captures as well as RU.
- `scripts/baam/browser-flow.ts`: real provider product creation, ordinary product link and persistent history. `browser-business.ts`: photo upload preserves initial draft, product create → receipt 8 → cash sale 2 → stock 6 / exactly one payment, including POS selling widget.
- `scripts/baam/browser-voice.ts`: real recording pipeline evidence; `provider-check.ts`: actual text/audio provider evaluation. Live calls are deliberately excluded from keyless deterministic CI.
- Unit regressions cover history, current-question focus, reader scroll, outbox retries, late responses across dialogs, first-click session resolution, roles, recorder lifecycle and strict tool/audio contracts. 26 BAAM DB integration cases exercise the action matrix, competing writes, lost responses, partial recovery and cross-tenant isolation.
- Full project checks include typecheck, lint, unit/integration suites, i18n validation and `scripts/baam/build.ts` (normal production build with isolated configuration). The initial full run inherited a local mail configuration; mail tests passed when explicitly using the project's log provider, without changing their expectations.
- `OPENAI_API_KEY` is the existing server secret. Optional `BAAM_TRANSCRIPTION_MODEL` overrides the tested `gpt-transcribe` default; text follows the existing configured model/default. Never expose keys to the browser.
- Push main, await **all checks for that exact SHA**, then await the normal gated Vercel production promotion. Verify build/migration logs, domain alias and `/api/version` SHA. Run `scripts/baam/production-smoke.ts --sha=<40 hex>` only afterward. It creates a new labelled QA organization, a zero-stock product through deployed BAAM, checks history/roles/mobile and archives synthetic products/disables test users. It creates no sale, payment, fiscal receipt or client email.

## Final local gate

1967 tests across 282 files passed with the isolated log email provider. Typecheck, lint, i18n check and production build passed. The optimized build was then checked over HTTPS localhost (required for production Secure cookies): ADMIN/MANAGER launcher and first click on POS/Inventory/Products/workspace; STAFF/CASHIER excluded; 360/390/768/1440 layouts, input focus, no horizontal overflow, RU/EN/KG screenshots inspected. Additional live-provider two-browser recovery test is prepared in `browser-recovery.ts`, but approval review blocked its external call; its result remains unverified pending explicit authorization. DB concurrency, same-UUID recovery and separate-dialog late-response tests did pass.
