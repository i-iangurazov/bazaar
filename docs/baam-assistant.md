# BAAM business assistant

BAAM helps an authorized business user answer a question, inspect the evidence, and reach the existing page where they can continue their work. The drawer and `/baam` workspace share a conversation. It does not duplicate the reporting dashboard or execute business changes.

## Product direction

The assistant serves four connected jobs:

1. Understand performance: summarize sales, compare periods, inspect returns and payment reconciliation, and identify recorded changes that merit investigation.
2. Find and inspect products: search the accessible catalog by name, SKU or barcode; inspect a product and its recorded sales/returns for the selected period; distinguish stronger sellers, weaker sellers and products without completed sales.
3. Reach the next step: open a product or an existing, permission-checked application page. Inventory movement, receiving, transfer and write-off document lists are allowed navigation destinations; BAAM does not operate those workflows.
4. Continue an investigation: preserve dates, store and the supported topic across follow-ups; offer relevant questions and destinations instead of repeating a fixed list.

Additional capabilities should extend these jobs through typed, authorized readers with independently verified definitions. Useful later readers include customer/order investigation, supplier purchasing history, catalog completeness, integration job health and carefully defined business alerts. A destination link alone must not be presented as the ability to analyze that destination's records. Forecasts, historical profit and recommendations to change stock require their own data and evidence contracts before they are advertised.

## Entry points and interaction

ADMIN and MANAGER use the bottom-right BAAM circle, sidebar, command search, mobile More or `/baam`. Existing role and analytics entitlement checks still apply. STAFF and CASHIER are not given access to the business assistant by this change.

The circle opens a drawer on supported pages. On `/baam`, it focuses the existing composer. It is hidden behind other open dialogs and on operational routes excluded from the stabilization scope. Where nearby controls intersect its normal position, it moves upward within the right gutter; it never moves off screen or over the app header. Dense layouts with no free gap keep the normal anchor and need separate layout review.

The welcome starts at the top. Suggestions depend on the current section or product, while subsequent questions come from the last answer. Product results are readable cards with direct product links. Evidence is expandable, and date-sensitive results state their exact period, store scope and business time zone. Enter sends a question; Shift+Enter inserts a line break and IME composition is preserved. A newly typed draft is not erased when a previous request completes.

## Dates, stores and conversation

Natural-language scope is resolved on the server before the model interprets the remaining question. Authorized store names stay local. Unknown or ambiguous scope requests produce a clarification rather than a query using unrelated default filters.

The calendar contract uses Asia/Bishkek:

- “Last two months” means the previous two complete calendar months. On September 5, 2026, that is July 1 through August 31.
- “This month” includes today; “last N days/weeks” uses complete days ending yesterday.
- “Last week” without a number means the previous Monday through Sunday.
- Explicit supported date ranges and named months with a year are accepted. Ambiguous dates need clarification.
- The maximum supported range is 366 inclusive days. A comparison uses the immediately preceding equal number of days, which is not necessarily the previous calendar month.

The response includes the resolved scope and reason. Successful date-sensitive answers synchronize the visible controls. Matching analytics links carry validated date/store query parameters. The analytics page rejects invalid or unauthorized URL scope before fetching results, and preserves those filters on refresh and navigation.

Conversation state lives in the authenticated layout's RAM. A short-lived signed context token carries only the bounded plan, scope and allowed record references; it is not authentication and does not contain a transcript or metric figures. Tokens are actor/organization-bound, expire after 30 minutes, and are invalidated by effective authorization changes. Current access is rechecked for every request and again before returning results. Manual filters reset question context. Drawer closure and a move to the full workspace preserve it; reload, logout or an account change clears it.

## Answer and evidence contracts

Sales answers use the existing completed-sales reporting contract: recorded sales after discounts, net sales after completed returns, receipt count, average receipt, recorded discounts, returns, and payment/refund reconciliation. Return amounts follow their own completion dates. The returns-to-sales percentage is a period ratio, not a cohort return rate. A zero comparison baseline does not produce an invented percentage change.

Diagnostics show observed differences in receipt count, average receipt, returns and net sales. These aggregates can identify what changed; they cannot establish why customers behaved differently or prove a causal explanation.

Product readers use a separate read-only projection. Catalog fields are current and do not claim to reconstruct a product's historical state. The product population is the current nonarchived catalog actively assigned to the selected accessible stores; variants combine at product level. Rankings state their measure and include zero or negative values when sorting lowest first. “Without completed sales” means no qualifying sold quantity in the stated period; it is not a claim of no demand or continuous availability. Line revenue and order-wide revenue may differ when order-level adjustments are not allocated. Product evidence describes these definitions separately from sales snapshot evidence.

Product rankings currently cover one period. Cross-period product comparisons receive an explicit clarification; they do not repeat the current ranking as a comparison. Unqualified rankings use net line revenue. Quantity ranking requires an explicit quantity request because different base units are not directly comparable. Lifetime requests require a supported, explicit period rather than silently using the current date controls.

A question such as “how much did it sell?” after identifying one product uses that product's freshly authorized sales/returns projection. Ambiguous references clarify; they never substitute whole-store totals. Navigation/help can preserve a still-valid analytical context without extending its expiration.

Sales evidence includes current and comparison query times, scope validation, metric version and query hashes. These are separate snapshots. Product evidence includes its read time, population, measure and whether dates were applied. Neither contract certifies upstream producer completeness, historical cost correctness, profit, stock availability or all sales channels.

## Authorization and tools

`baam.ask` accepts a bounded question, dates, optional store, locale, signed context and an optional page reference. Section context is an allowlisted enum. A product-page ID is an untrusted reference until a fresh catalog/store lookup authorizes it. Client-provided figures, actors, organizations, arbitrary URLs and SQL are rejected.

Navigation is a static catalog of real application destinations. Every link passes current role, route and feature checks. Product links come only from authorized query results. The model never supplies a URL or record identifier that becomes trusted without validation.

`baam.capabilities` reports local availability, whether AI interpretation is configured, and authorized navigation IDs. Local navigation, capability guidance, common analytical questions and recognized product requests do not require an external provider. An unrecognized request with no configured provider receives an explicit limitation; it is not answered with unrelated figures. Configured provider failures remain visible rather than silently becoming a simulated AI answer.

The route retains the per-user five-requests-per-minute limit. Rate-limit wiring tests and real Redis verification must be distinguished in release evidence.

## Provider privacy and failures

The existing `OPENAI_API_KEY` and optional `OPENAI_MODEL` configure free-form interpretation. The model chooses a strict typed plan; server readers and renderers supply every numeric claim. It cannot execute arbitrary tools, SQL or business mutations. Database figures, catalog records, store names, actor IDs and prior transcript are not sent to the provider. Resolved date/store spans are removed locally. Users may still include private information in free text; this is not a promise of automatic de-identification of arbitrary input.

The Responses request uses `store: false`, a strict structured-output schema, bounded output and a 20-second request/body deadline. Provider refusal, invalid output, non-success responses and timeouts fail explicitly. No automatic provider retry is performed. Database transactions have separate deadlines and do not remain open during provider calls. `store: false` is not a claim of zero provider retention.

The original integration was checked against the official [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs) and [Responses reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create) on September 5, 2026. Mock interpretation tests establish the API and rendering contract; actual interpretation accuracy and provider availability require separate live checks.

## Verification records

The original readiness audit remains in `artifacts/bazaar-assessment/20260905T114424Z/`. Subsequent releases retain their own evidence in `artifacts/bazaar-reliability/20260905/`. This implementation's tests, browser checks and exact-commit release verification are recorded separately in `artifacts/baam-professional/20260905/`; unfinished checks must not be counted as passing.
