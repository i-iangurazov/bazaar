# Apple support and payer-departure recovery

The platform page contains Apple purchase recovery for currently allowlisted
platform operators. Customer administrators and impersonated sessions cannot use
it. Operator identity, active/deleted state and the current platform allowlist
are checked again under a User lock at verified evidence application, after the
customer organization lock; a stale page or revoked operator cannot apply money.
The permission is the existing platform capability, not a customer ADMIN role.

## Review an actual case

1. Open the Apple purchase recovery card. Its paged list contains unrecorded
   authorized attempts and individual financial REVIEW records. A full
   `intent:…` or `transaction:…` reference can load a historical case directly.
2. Confirm the company, product/environment, actual Apple currency and case
   status. Device attempt UUIDs, public/private keys, nonces, raw signed evidence
   and private payer identity are not included in the list/detail response.
3. For an enrolled attempt with an already earned native terminal outcome, retry
   from the original device. Its Keychain capability can finish that old attempt
   after logout, employee departure, demotion or deletion. It restores no account
   or new purchasing permission. A new administrator cannot claim that key.
4. **Check with Apple** fetches only known transaction/status references, verifies
   every relevant signed result and applies it through the normal immutable
   organization binding. The periodic recovery job remains responsible for full
   transaction/notification history. A reference-less attempt is explicitly left
   unresolved; an empty response never means unpaid or canceled.
5. If actual Apple-signed transaction evidence is available for this case, open
   it and use the limited evidence form. Confirm the selected company/case and
   submit that signed payload. The server verifies it independently, checks the
   exact token/environment/case binding and records the evidence digest in an
   audit entry atomically with receipt application. Payer deletion does not
   prevent this provider-authoritative financial recovery or restore that user.
6. Refresh the case and company billing. A real retained charge may remain REVIEW
   because of overlap, changed source or invalid quantity/offer. Follow the
   original provider's management/refund path. Submitting a refund request or a
   support note does not establish a refund; verified later Apple evidence does.

There is no **mark unpaid**, **clear hold**, manual absent-payment attestation,
purchase reassignment or database-edit step. Apple money cannot become a GoPay
invoice, KGS total or an invented independent full-term grant. A refund removes
only its own funding and preserves independent GoPay coverage and recorded use.

## Capability and ambiguity boundary

New devices enroll a completion-only P256 public key at final authorization.
Private keys remain in Keychain and earned results remain in protected native
storage. Fresh challenge signatures can authenticate the original previously
authorized device after the payer loses account access. Only actual caught
pre-SDK abort, definitive OS cancellation, or verified old-transaction deferred
success can earn a completion. Neither a current administrator nor an operator
can create that device result from their own statement.

This uses the explicitly approved native terminal-outcome trust model. It is not
App Attest or an Apple-signed proof that no charge happened. A missing key, lost
device, keyless old attempt or hard crash without earned proof remains genuinely
ambiguous. Preserve REVIEW and seek actual signed Apple evidence. The API cannot
look up an initial transaction solely from an app-account token when no Apple
transaction reference is known; absent references are not proof of absence.

## Rollout and verification

Deploy the additive `20261111160000_apple_deferred_outcomes` schema/server before
the native completion cohort. Earlier applied SQL, including143, is unchanged.
Do not backfill keys into already authorized attempts. Keep the previous
schema-compatible server available for a sales-off forward rollback; an older
server cannot safely interpret the new cohort or deferred evidence.

Meaningful isolated tests cover actual P256 signatures, forged/cross-scope
requests, replay, payer deletion/demotion/deactivation, money races, immutable
evidence, operator permission changes during verification and genuine synthetic
Apple-signed financial recovery. Passing synthetic tests, code review and local
StoreKit checks are distinct from actual Apple Sandbox and real-device acceptance.
