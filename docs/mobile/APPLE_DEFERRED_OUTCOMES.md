# Earned native deferred-change outcomes

An automatic subscription downgrade can return the already active transaction,
while a different product is selected for the next renewal. Apple documents the
[verified purchase result](https://developer.apple.com/documentation/storekit/product/purchaseresult)
and the [next-period renewal preference](https://developer.apple.com/documentation/storekit/product/subscriptioninfo/renewalinfo/autorenewpreference)
separately. A renewal preference describes future subscription state; it is not
a receipt for the result of one Bazaar purchase invocation.

The server consequently never completes final-authorized intents from a renewal
notification alone. This includes renewal-OFF, another chain's update, and a
matching preference that arrived before the purchase result. Authorized unknown
outcomes continue to block another checkout after the old known coverage ends.
A departed payer does not cause the organization binding or its money obligation
to be reassigned or erased.

## Exact native result and signed evidence

New automatic CHANGE intents freeze the active original chain, durable previous
transaction, current product, group, environment and signed expiry inside their
immutable offer snapshot. Native prepare/final authorization expose `action`,
`subscriptionGroupId` and nullable
`deferredSource:{transactionId,originalTransactionId,productId,expiresAt}`.
The target product/account token still come exclusively from authorization.

Only the winning actual `Product.purchase` invocation may earn proof: it must
return `.success(.verified(existingTransaction))` for that frozen old product.
Native persists the result with its already-bound attempt UUID before awaiting
renewal status. A separately verified matching renewal JWS must identify the same
environment, original chain and account token, current old product and requested
next product, renewal-ON and the exact old expiry. Its signed date must fall after
final authorization and before that expiry. The captured proofs can be retried
after expiry; retry does not create a new terminal outcome.

`POST /api/billing/apple/native/deferred` accepts exactly:

```ts
{ intentId, attemptId, signedTransactionInfo, signedRenewalInfo }
```

The server verifies both JWS objects independently and locks the original
organization. The legacy authenticated route additionally checks the current
original ADMIN payer. New enrolled attempts use the original device's signed
completion capability described below, which can complete that existing attempt
after logout, role loss or deletion without restoring a session. The old
transaction must already have been durably GRANTED before
authorization, belong to the frozen source, and remain unrefunded and
unsuperseded. Source-less historical intents cannot be reconstructed by guessing.
Another administrator, device attempt, organization, product, group, token,
environment, date, current-product receipt or renewal-OFF cannot qualify.

With no financial receipt on this intent, one append-only
`AppleNativeDeferredOutcome` records the signed proofs and their digests. Only
that intent becomes complete. The existing chain retains the signed future
limits; base/future periods, usage and financial records are unchanged. A newer
already-verified OFF or different preference is preserved on historical retries.
The successful response is:

```ts
{ acknowledged: true, deferred: true, recorded: false, scheduled,
  intentId, productId, effectiveAt }
```

`scheduled` reflects the current still-future preference. `deferred:true` with
`scheduled:false` acknowledges historical outcome evidence and is not a promise
that the old choice is currently scheduled. The client refreshes actual state.

If any financial receipt is already recorded on this intent, money takes
precedence:

```ts
{ acknowledged: true, deferred: false, recorded: true, intentId,
  status: "REVIEW" | "COMPLETED", reason }
```

This clears only redundant local proof and hands recovery to the normal money
flow. It creates no deferred evidence and never clears financial REVIEW, revokes
or grants access, or finishes a new transaction without its normal server ACK.
An ACK for one invocation cannot resolve another receipt's review obligation.

## Trust and unresolved outcomes

Apple signs the transaction and renewal state, but does not sign Bazaar's native
attempt UUID or the fact that this particular invocation returned the old result.
That provenance uses the same authenticated original winning native terminal
outcome model as the existing exact-attempt OS cancellation. It is strengthened
by both matching Apple-signed objects; it is not App Attest, a cryptographic proof
of absent charges, or a general client declaration that nothing happened.

JavaScript cannot create the native journal entry, supply an action/product, or
replace an unknown outcome. A modified native client controlling the enrolled
private key still shares the approved terminal-outcome trust boundary; neither
that key nor a renewal preference is an Apple-signed proof of absent charges.
Cold start, empty history, timeout, process death, `.pending` and an unverified
result never earn deferred proof. Captured proof lacking matching signed renewal
evidence retains its protection; another user cannot claim it. Keyless historical
attempts, missing keys and genuinely ambiguous outcomes retain their protection
and have the [operator case path](APPLE_SUPPORT_RECOVERY.md), without manual
attestation of absence or unsafe hold clearing.

## Pre-enrolled completion after payer departure

Before sending final authorization, native stores a per-attempt P256 signing key
in Keychain. The request includes canonical base64 SPKI DER `completionPublicKey`.
The server enrolls it atomically with the original fresh administrator's winning
attempt, immutable organization and canonical origin; it echoes the SHA256 DER
fingerprint and final `authorizedAt`. A final authorization remains one-use.
Missing historical keys cannot be backfilled, replaced or obtained from the web.

An earned CANCELED, NOT_STARTED or DEFERRED result requests a fresh five-minute
challenge from `/api/billing/apple/native/completion/challenge`. Its request binds
the opaque intent/attempt/fingerprint and outcome; DEFERRED also binds both JWS
SHA256 digests. The server seals the challenge with a purpose-separated HMAC and
returns no user, organization or private case data. Issuance creates no database
row. Native signs the challenge's exact UTF8 bytes with P256 SHA256, raw64 P1363
`r||s`, standard base64, and posts it to `/api/billing/apple/native/completion`.

These two narrowly scoped endpoints require the exact enrolled trusted origin
and native app header, not an account cookie. They validate the seal, signature,
freshness and immutable scope again under the organization lock. One append-only
`AppleNativeCompletion` consumes the proof. It can finish only its already earned
terminal outcome: no new authorization, session, sheet, grant, refund decision or
organization transfer is available. DEFERRED still requires both Apple JWS
objects and all source checks above. Any money already recorded takes precedence
and retains its REVIEW/rights; the ACK only hands off to financial recovery.

An earned deferred journal can temporarily lack the second JWS. The distinct
`RECORDED_ONLY` challenge outcome is a signed read-only lookup for that enrolled
attempt, with no JWS digests. It requires a fresh challenge even on replay. If
money exists it returns the same RECORDED ACK; otherwise it returns
`{acknowledged:false,kind:"PENDING",recorded:false}`. It creates no completion or
deferred record and changes no hold. PENDING never clears the earned journal,
attests absent payment, or permits another purchase.

If an otherwise valid original source was revoked/superseded only after the
captured Apple preference, the server can record the historical terminal result
without restoring that source. Every invalidation timestamp must be known and
no earlier than both final authorization and the signed preference. An unknown
invalidation or a prior one retains protection. Historical completion never
applies the old renewal preference or changes grants, quota or refunds, and
returns `scheduled:false`.

Retries of a consumed identical outcome are idempotent, including after a lost
ACK. A stale unused challenge cannot create a completion; native requests a fresh
one while retaining the earned proof. A different key, attempt, origin, outcome
or JWS digest cannot reuse it. Enrolled attempts cannot bypass this protocol with
the legacy bare cancellation/deferred route. An inaccessible enrollment keeps
native proof but is excluded from actionable retry counts, without any financial
claim or fallback cancellation. Network/limit/server failures remain retryable.

The additive migration is `20261111160000_apple_deferred_outcomes`. It retains
append-only outcome/completion evidence with tenant foreign keys, immutable
first-authorization key enrollment and a winning-source guard, and
serializes financial inserts with outcome acceptance. Applied migration143 is
unchanged. The append-only correction
`20261111170000_apple_completion_utc_clock` compares the real clock explicitly in
UTC for UTC-naive challenge timestamps. It retains the same five-minute validity,
future-clock and all binding checks in every database session time zone;144 is
unchanged. Isolated PostgreSQL and native regression coverage must be recorded by
the coordinated check runner; synthetic signed tests do not demonstrate actual
Sandbox behavior or real-device acceptance.
