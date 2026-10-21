# Working agreement for Bazaar improvements

## Shared improvement branch

- Collect product improvements on `codex/playground`. It was created from the freshly fetched `origin/main` at `6aadb6c8947b82df7632fdd0ef4d82eddbd72e47` on 2026-10-21.
- Continue using this branch for subsequent improvements unless the human explicitly requests another branch. Check the current branch and working tree before editing; preserve unrelated work.
- Do not merge improvements into `main`, push to `main`, or deploy production until the human explicitly authorizes that action. A request to implement an improvement is not permission to merge the accumulated branch.
- Keep reviewable commits, a record of verification and any remaining limitations. Before an eventual merge, verify the accumulated result against the then-current `main`, including conflicts and regressions across earlier improvements.

## Quality of every delivery

- Treat this branch with the same care as production. A playground branch is a place to accumulate finished improvements, not permission for unfinished behavior or lower quality.
- Understand the complete affected user flow, domain rules, authorization, data model and integrations before changing them. Preserve existing capabilities, records and previously granted access unless the requested change explicitly requires otherwise.
- Finish the requested behavior, including loading, empty, error, retry and recovery states where relevant. Do not represent a stub, simulated payment, untested provider or partial flow as complete.
- Verify the actual behavior with meaningful regression tests. For affected business flows, include real database integration checks in a disposable test environment. For UI changes, inspect the affected desktop/mobile states. Cover relevant roles, organizations, stores, subscription gates, currencies and business dates.
- Run type checks, lint, translation validation and the relevant tests. Run a production build when application code changes. Broaden regression checks according to the affected shared code; record commands, outcomes and checks that could not be completed.
- Use only explicitly isolated test infrastructure. Never reset, seed, migrate or create test transactions in customer/production databases. Keep provider calls and production changes outside automated tests.
- Add user-facing strings for Russian, Kyrgyz and English. Keep public product promises consistent with server-enforced capabilities and with the application UI.
- Preserve financial, inventory and external-operation idempotency. Language models do not establish payment success or calculate authoritative business amounts.

## Subscription direction

- Prioritize payment methods usable by customers in Kyrgyzstan, with KGS and a confirmed merchant setup. International coverage is secondary.
- The human confirmed on 2026-10-21 that the seller is an IP (individual entrepreneur) with a KICB account; acquiring is not connected yet. Do not assume an existing provider contract or collect provider secrets in chat.
- Complete tariff consistency and the confirmed forecasting store-access defect before introducing payment collection.
- Confirm the actual seller, merchant capabilities and the treatment of existing businesses before enabling payments. Preserve existing approved/free access while preparing payment integration.
- Separate the merchant's subscription to Bazaar from customer purchases in merchant stores. Provider redirects are not proof of payment; verified server results and reconciliation determine payment state.
