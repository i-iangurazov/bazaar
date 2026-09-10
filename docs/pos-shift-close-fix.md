# POS shift closing: receipt resolution

The reproduced failure required a held receipt and another active cart belonging to the
same cashier. Resuming the held receipt correctly failed on the server, but the checkout
still displayed the other cart. Completing that cart left the original held receipt open.
The closing screen offered no cancellation for held receipts and advised holding active
receipts even though held receipts also blocked closing.

On mobile, the navigation guard could also retain the one-shot resume URL beneath its
history entry. Finishing the sale restored that URL and reopened a stuck resume screen.
The guard now starts after the resume URL is consumed, and a later explicit resume intent
is checked again against the server.

## Resolution matrix

| State | Working path | Verification |
| --- | --- | --- |
| Held receipt and another active cart | Show both numbers; finish/cancel the active cart first, or cancel the held receipt directly | Browser conflict gate; original held ID subsequently completes |
| Active receipt owned by the user | Continue that exact receipt or cancel with confirmation | CASHIER, MANAGER, ADMIN browser workflows |
| Another cashier's active receipt | Existing audited ownership transfer; supervisor cancellation | Existing permissions tests; manager cancellation regression |
| Shared held receipt | Resume or cancel through POS services | Cashier cancellation and completion integration tests |
| Empty cart | Cancel without payment/stock effects; resume can replace an unchanged, unposted empty cart | All three roles; concurrent line insertion regression |
| Draft return | Existing cancellation service, followed by fresh state | Multiple-blocker integration scenario |
| Completed/canceled receipt | Does not block; current state replaces stale warning | Database filters, cross-tab browser scenario |
| Failed payment validation | Sale stays an unpaid draft; correct payment or cancel | Wrong card total creates no payment/stock effects |
| Draft with recorded financial/fiscal/stock effects | Reject ordinary cancellation; preserve evidence for investigation | Corrupt-fixture regression; no such case in production diagnosis |
| Lost closing response | Read the exact shift again, bypassing cached X-report; replay uses the same key | Browser drops a successful response, then verifies CLOSED and one close |
| Concurrent sale/new draft and closing | Lock the shift before receipt operations; closing rechecks its own register/store/shift | Database concurrency tests |

The closing screen includes receipt number, time, amount, owner and status. Links preserve
the return path to closing. No warning disappears optimistically: successful mutations
trigger fresh server reads. Store-scoped events and polling cover other tabs, with old
requests canceled before refreshing. Internal shift closing remains separate from KKM.

## Validation and boundaries

- Six POS/access/event integration suites: 86 tests, including 16 new resolution tests.
- POS and mobile-navigation unit suites: 96 tests. Legacy source checks now require server
  refreshes instead of the removed optimistic blocker rows; behavior is covered in the browser.
- Browser regression: held → conflicting resume → cancel active → complete original held
  → cancel empty cart in another tab → close; verifies all three roles and 200 KGS totals.
- Browser checks delayed stale responses and lost close responses, RU/KG/EN, and
  360/390/768/1440 px layouts. The workflow is included in the existing UI CI job.
- Production read-only diagnosis found three nonempty drafts in open shifts, none held,
  and none with payments, fiscal receipts or stock movements. These are not proof of data
  corruption and were not canceled or rewritten.
- POS payment rows represent completed internal payments, not pending external acquiring
  attempts. Tests use isolated organizations and no live payment/fiscal providers.
- No schema migration, force close, posted-document deletion, inventory calculation or
  zero-cost policy change is part of this fix.

For release verification, run `scripts/pos-shift-close/browser.ts` only through a wrapper
providing isolated fixture users, organization, store and product. It creates synthetic
internal sales. Production verification must first check the expected `/api/version` SHA
and disable KKM/integrations for that fixture; retain operation IDs and reconcile the
database afterward. Follow `docs/custom-domain-release.md` for exact-SHA CI and domain checks.
