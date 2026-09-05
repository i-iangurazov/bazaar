# BAAM question assistant

BAAM now accepts a business question through `baam.ask`. The model chooses an intent and a small set of metric references. The server builds the answer from freshly authorized reporting results, including the immediately preceding period of equal length. The model cannot supply figures, execute tools, read arbitrary records, change data, or run SQL.

## Access and conversation

Use the circular BAAM button at the bottom right of supported application pages, or open `/baam`. Command search and mobile More also expose the workspace to authorized roles. The old metric-card dashboard has been removed. Every answer can link back to the existing analytics page; that page currently requires selecting the same dates and stores manually.

The drawer and full workspace share the current conversation, draft and date/store selection in the authenticated layout's RAM. A pending request can finish while the drawer is closed. Reopening revalidates access. Reload, logout or an account/organization change clears this memory; no transcript is stored in browser storage or the database. Changes to authorized stores or a failed permission check clear protected history. Previous conversation is displayed for the user but is not sent to the model: each new question is interpreted independently using the selected controls. Availability failures offer an explicit retry.

## Supported contract

`baam.capabilities` checks current membership, role, subscription and analytics entitlement. Its `available` flag means an API key is configured; it does not prove that the provider, model or account is healthy. `baam.ask` uses `managerProcedure` and the existing per-user rate limiter, limited to five requests per minute outside test/CI.

Input is strictly limited to `question` (1–1,500 trimmed characters), `dateFrom`, `dateTo`, optional `storeId`, and `locale` (`en`, `ru`, or `kg`). Actor identity comes from the server session. Client metrics, history and organization/actor overrides are rejected.

Supported answers describe recorded sales, net sales, receipts, average receipt, recorded discounts, returns and payment/refund reconciliation. Comparisons use server-calculated differences; a zero baseline never produces an invented percentage. Return amounts use their own completion dates, so returns divided by sales is a period ratio, not the return rate of a sales cohort. Changes in that ratio use percentage points.

The selected UI controls define the date/store scope. The model is instructed to classify explicit or relative dates and named stores as unsupported scope requests; the response asks the user to change the controls. It does not resolve natural-language dates or store names. All answers state the actual selected dates, business time zone and KGS currency. Causes, forecasts, profit, unrelated data and requested actions receive a limitation and follow-up suggestions, without unrelated figures. Intent classification is model-dependent; the schema and server renderer prevent arbitrary numeric or causal claims even if the intent is misclassified.

## Authorization and freshness

Each period is read in its own read-only, repeatable-read transaction using current database membership, role, subscription and store grants. The comparison uses the same authorized organization and store set; changes abort the answer. After the provider completes, a third short read-only transaction rechecks those grants before any earlier facts are returned. No database transaction remains open while waiting for the provider.

Evidence includes both periods, authorized store names, both `currentQueriedAt` and `previousQueriedAt`, the final `scopeCheckedAt`, metric version and two query hashes. The legacy `queriedAt` response field is retained as the previous-period query completion time. These are separate snapshots, not an atomic snapshot of both periods. The underlying reporting contract does not prove producer completeness, and no source-complete-through timestamp is asserted.

## Provider behavior and privacy

The existing `OPENAI_API_KEY` and optional `OPENAI_MODEL` are used; the fallback model remains `gpt-5-mini`. The `minimal` reasoning setting is sent only for the original GPT-5 family and its dated snapshots; other configured models receive no forced reasoning parameter. A configured model must support Responses structured outputs. Unsupported configuration fails explicitly rather than returning a simulated AI answer.

Only the user's question and static interpretation instructions/schema are sent to OpenAI. No database-derived metrics, dates, store names, organization/user identifiers, customer records or prior conversation are included. Users can still type personal information into the question; this is not a claim that arbitrary free text is automatically de-identified.

The Responses request uses `store: false`, strict `text.format` JSON schema, no tools, no conversation identifier and a 500-output-token limit. `store: false` controls response storage for API retrieval; it is not a claim of zero provider retention. The provider request and body read have one 20-second deadline and no automatic retry. Database transactions retain their own 15-second limits, so the entire route is not guaranteed to finish within 20 seconds.

Refusal, incomplete output, malformed/extra plan fields, unsupported references, non-success HTTP responses and timeouts fail with `baamUnavailable`; no raw provider response or question is attached to that error. A missing key returns `baamNotConfigured`; changed authorized scope returns `baamScopeChanged`. Manual resubmission can incur another provider charge, including after a timeout.

The API shape follows the official [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs) and [Responses creation reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create), checked September 5, 2026. The OpenAI Docs skill and the repository's existing Responses implementation were consulted.

## Verification and remaining limits

Executed isolated checks: 42 new assistant unit tests, 12 existing reporting-boundary unit tests, and six PostgreSQL authorization tests. The latter use real synthetic accounts/organizations/store grants, the narrow BAAM router, and stored mid-request disable/grant changes. Report projections and model transport are mocked; no operational POS/Inventory producer or live provider is executed. The local configuration has no legacy global setup, reset or migration action. TypeScript and scoped ESLint passed.

The mocked provider checks establish the request/response contract, rejection behavior, deadline and deterministic rendering. They do not establish live model interpretation accuracy, real provider availability, latency, cost, production question quality, or full producer-to-report correctness. Multilingual scope/unsupported test cases validate handling of synthetic classified responses, not a live model's classification. The existing rate limiter is wired into the route but bypassed by the application's test policy; these tests do not claim to exercise production Redis rate limiting.

Machine-readable evidence is in `artifacts/bazaar-reliability/20260905/baam-backend-unit.json`, `baam-backend-access.json` and `baam-backend-handoff.json`. The prior backend offered only `baam.overview`; this adds a question workflow while preserving that query for current consumers.
