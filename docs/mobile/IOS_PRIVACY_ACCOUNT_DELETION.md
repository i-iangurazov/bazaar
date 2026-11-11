# iOS privacy, AI sharing and account deletion

Implementation inventory, 2026-11-11. This records the behavior in this branch and the owner decisions still needed before release. It is not a submitted App Store privacy declaration or a legal retention schedule.

## Account deletion

Profile settings → Privacy and account → Delete my account is available to every signed-in role, including after trial/subscription expiry. Administrators impersonating a person cannot delete that person's account or consent for them. The user re-enters their password and types `DELETE` before the irreversible transaction. A failed password, invalid successor or failed transaction leaves the account intact.

The transaction locks the organization and its users, then:

- Erases the person's name, email, phone, job title, signup attribution and credentials. The email becomes a random address at `deleted.invalid`, the password is replaced by an unknowable random secret, and a permanent `deletedAt` tombstone prevents reactivation. `sessionVersion` invalidates all previously issued login sessions, even if their JWT has not expired.
- Deletes authentication/recovery tokens, personal access assignments, guide state, push registrations, access requests under the old email and pending invitations issued by the person. Existing impersonation sessions are revoked.
- Erases private BAAM message text, attachments, transcriptions and editable workflow parameters/results. Conversation titles and page context are removed. Historical execution receipts and financial idempotency evidence stay with the business, and late responses cannot append messages to the erased conversation.
- Removes the former identity from profile/token/invitation audit snapshots, while keeping an audit envelope and a non-identifying account-deletion record. It cancels and redacts personal subscription notification outboxes.
- Queues private attachment URLs in `AccountErasureAsset` without the former person's email/name. `account-asset-erasure` runs immediately as a background attempt and in the existing recovery job group. Missing files count as successfully erased; temporary storage failures retry with bounded backoff. Product photos, company studio files and another person's current attachments are retained when they reference the same content-addressed object.

The organization lock uses `FOR NO KEY UPDATE`: it still serializes organization writers while allowing an existing user's consent/profile audit foreign-key check. A real isolated PostgreSQL reproduction on pinned migration 143 produced `40P01` with the former `FOR UPDATE` lock; the same real consent-withdrawal/sole-owner-deletion orchestration passed after this bounded change. Fresh user authorization, ordered user locks and owner handoff remain intact. Root's private evidence is `privacy-lock-before-fix.log` and `privacy-lock-after-fix.log`; this is a local concurrency result, not a customer migration or device-release claim.

The remaining User row is an irreversible pseudonymous author reference for existing company records. It is not a disabled account that an administrator can restore: login, token recovery, user editing, password resets and database-level restoration are rejected. A person registering again gets a new account and does not regain the erased account's organization membership or Apple purchase binding.

An organization owner with active colleagues selects a successor unless another active owner already exists. The chosen colleague must belong to the same organization and be active/not erased. The confirmation explains that the colleague becomes an administrator and owner of the whole organization; existing sessions for that colleague are invalidated. A sole active owner can delete immediately without contacting support; the company's business records remain without that login. Another user's account, access and business records are not erased.

Deleting a Bazaar account does **not** cancel Apple's auto-renewal. The confirmation explicitly asks the person to manage/cancel renewal first and offers StoreKit subscription management on iOS, with Apple's [subscription account page](https://apps.apple.com/account/subscriptions) as fallback. Immediate deletion remains possible. Apple/GoPay payment journals and purchase bindings remain independently of personal login deletion, so erasure cannot reset a paid entitlement or make an old transaction claimable by a different organization.

## External AI processing

The versioned notice is `2026-11-11`. No existing customer is automatically treated as having consented. Choosing “Allow sharing with AI services” records the version and timestamp; declining and withdrawing are separate explicit actions. Other Bazaar features remain usable. A changed notice version requires a fresh decision.

| Recipient | Data that current code can send | Purpose and permission boundary |
| --- | --- | --- |
| DeepSeek | User text, recent authorized BAAM context, selected business data and some image analysis | Answers, request understanding and product content. Text-response network calls require a current, active, same-organization initiating user's consent. |
| OpenAI | Text/selected business context, selected image content, recorded voice audio | Configured text assistance, image analysis/generation and voice transcription. The same consent boundary applies to text, image and audio network calls. |
| WhatsApp assistant's DeepSeek processing | Customer message text, bounded history, selected attachment and the merchant's approved catalog/knowledge context | Existing `WHATSAPP_PRIVACY_APPROVED` launch gate remains. Each model attempt additionally requires current consent from an active organization owner. The merchant's customer notice/lawful-basis obligations are a separate launch decision; an employee's consent is not presented as a customer's consent. |

Authenticated tRPC requests bind the initiating identity through async context. Workers explicitly bind the person who requested the job, so another user's later visit or a server retry cannot grant permission on their behalf. Missing identity, cross-organization identity, deleted/deactivated user, impersonation, old notice version or revoked consent fails closed at the provider boundary before sending a request. Every new provider attempt rereads consent; withdrawal therefore blocks queued/retried requests too. It cannot recall data already transmitted or stop a request already in flight at the provider.

Permission is reread after awaited budget reservations and preparation, immediately before each new text, WhatsApp, image or voice request. A withdrawal committed while a job waits for its budget therefore prevents that dispatch. If no request was dispatched, its provider estimate is returned without recording model usage; failed voice work also releases the unused customer-operation reservation. The actionable `aiConsentRequired` error is retained. Once a request has been dispatched, an unknown transport outcome retains its conservative expense; withdrawal cannot turn an already-started request into a free retry. A definite image rate-limit response can retry only after a fresh permission check.

BAAM shows the notice before composing/uploading voice or images. Profile settings show status and withdrawal. Other AI entry points return the translated actionable `aiConsentRequired` error and a path to the same settings; job creation also checks permission before queueing paid AI work. The server check remains authoritative even if a client has stale consent state.

The notice names both supported AI processors and explains possible processing outside Kyrgyzstan, voluntary use, purposes, data scope and withdrawal. It links Bazaar's policy and the processors' policies. Provider credentials and actual deployment configuration are not inferred from the presence of code.

## App Store privacy review inventory

### Private BAAM media

New BAAM-only image uploads are AES-256-GCM encrypted before persistence in the private PostgreSQL attachment record. Each image uses a fresh nonce, with organization, conversation and MIME type bound into the authentication tag. The encrypted envelope is never placed in public product storage, a client DTO, a BAAM message or prepared action. Upload responses and message attachments expose only `/api/baam/media?attachmentId=…`; that route authorizes conversation ownership and streams image bytes with `private, no-store` and `nosniff`. AI preparation decrypts only on the server into the bounded provider image input.

Set `BAAM_MEDIA_ENCRYPTION_KEY` to the canonical base64 encoding of 32 cryptographically random bytes. An absent, malformed or wrong key fails closed; there is no auth-secret fallback. Retain the key for existing images and include it in controlled backup/key-management procedures. Key changes require a deliberate migration of existing envelopes; changing the environment variable alone does not re-encrypt them.

Private BAAM media needs no local disk, public bucket, or R2 credentials, so it works with the isolated Vercel/Neon preview. Source and stored image payloads are bounded to 3 MiB. When the person explicitly confirms using an attachment as a company product photo, the execution step decrypts and copies it into the existing organization product-image storage. That separate adopted company asset survives personal account erasure. Organization product-image storage needs a persistent provider; the isolated Preview has an explicit two-store Blob option for product photos and private exports, documented in [IOS_PREVIEW_STORAGE.md](./IOS_PREVIEW_STORAGE.md). Private BAAM encryption does not make an ephemeral serverless filesystem a persistent product-media store. Production's existing local/R2 provider choice is unchanged.

Legacy BAAM attachments are now also served through the authenticated streaming route. Their old public origin/CDN copies still need the historical purge/backup process described below. New encrypted BAAM payloads are erased with their attachment records and never enter the public-object erasure queue.

Owner review is still required before answering App Store Connect's privacy questionnaire. Do not select “Data Not Collected” merely because the iOS binary embeds the web app. Relevant existing code includes:

- Account name/email/phone, organization and role identifiers, authentication/session cookies and security audit data.
- User-selected product/customer/business records, financial operation data, uploaded photos/documents, private BAAM text, voice and derived transcripts.
- Payment/entitlement status from Apple and web GoPay, with payment provider processing separate from customer purchases in merchant stores.
- Device installation identifiers/push tokens and optional device/app metadata for notifications.
- Operational logs/diagnostics and first-party acquisition attribution where permitted by current privacy controls.
- Configured storage/email/integration processors, including R2 and Resend, plus customer-enabled merchant integrations. AI sharing permission does not stand in for review of these service processors.

Determine the actual collected categories, linkage to identity, purposes, provider retention/regions, tracking answers, optional disclosures and enabled production services from the final release configuration and SDK manifests. No completed App Privacy declaration is claimed by this document.

## Remaining operational and owner decisions

1. Approve the actual legal reasons and time limits for retaining financial/security/contract records, the pseudonymous audit reference and backup copies. No duration has been invented in code or the policy. Company legal/contact fields are not silently removed by deleting one employee's login.
2. Verify the recovery scheduler is deployed and `AccountErasureAsset` backlog is monitored. Investigate persistent `accountAssetRetry` records without exposing URLs or former identities in logs.
3. Historical BAAM files created before private-media encryption share the product upload/CDN path. Origin-object deletion cannot promise immediate purge of third-party caches or already downloaded copies. Confirm CDN purge/backup handling and the retention process before public release. Do not describe these copies as instantly erased. New BAAM media uses the encrypted/authenticated flow above.
4. Confirm the actual processor agreements/regions/retention and customer-facing WhatsApp processing notice. Do not enable the WhatsApp privacy launch gate solely because employee AI consent was implemented.
5. On a real iPhone/TestFlight release build, test the visible notice, refusal, grant, revocation, lost connectivity/retry, password rejection, owner handoff, Apple management/cancellation warning, successful deletion and rejected old sessions. Verify native sign-out and device push behavior. Local tests cannot establish Apple account cancellation or App Review acceptance.

## Apple references checked on 2026-11-11

- [Account deletion guidance, including subscription handling](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/): in-app initiation, full personal-account removal, justified retained records, and subscription management with immediate deletion available.
- [App Review Guidelines §5.1.2(i)](https://developer.apple.com/app-store/review/guidelines/#data-use-and-sharing): disclose third-party AI sharing and obtain explicit permission before sending personal data.

## Verification

Checks include `tests/integration/account-deletion-privacy.test.ts`, `tests/unit/ai-privacy-boundary.test.ts`, and `tests/integration/ai-consent-dispatch.test.ts` (real PostgreSQL budget waits, committed withdrawal, zero outbound/expense, retry/replay and uncertain-dispatch accounting). `tests/integration/privacy-deletion-lock-order.test.ts` exercises real consent/audit and erasure transactions concurrently. Existing provider routing and session-security checks remain relevant. Root coordinates all heavy checks and disposable PostgreSQL runs; no customer database or live provider is used by these tests. See `IOS_RELEASE_PROGRESS.md` for the final executed command/results record; adding a regression does not itself establish that it passed.
