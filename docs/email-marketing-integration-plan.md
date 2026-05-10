# Email Marketing Integration Plan

## Current Implementation Findings

- The app has an email service in `src/server/services/email.ts` with Resend and log-provider support.
- Existing email sending uses `process.env.EMAIL_FROM`. There is no public generic email campaign sender yet.
- `.env.example` contains `EMAIL_FROM`; campaign sending must require `EMAIL_FROM=no-reply@bazaar.kg`.
- `/operations/integrations` already renders integration cards and status summaries for Bazaar Catalogue, bazaar API, M-Market, Bakai Store, and Image Studio.
- There is no email marketing card, page, campaign history, recipient tracking, or customer audience service.
- Store-scoped customer data does not exist yet, so the email integration depends on the new `Customer` model.
- Admin/manager-only integration access can reuse `managerProcedure` server-side and `manageIntegrations` UI permissions, but staff/cashier must not reach customer emails.

## Data Model Proposal

Add campaign history models:

- `EmailCampaign`
  - `id`
  - `organizationId`
  - `storeId`
  - `createdById`
  - `status`: `DRAFT`, `SENDING`, `SENT`, `FAILED`
  - `template`: `ANNOUNCEMENT`, `PROMOTION`, `NEW_ARRIVALS`, `SALE`, `CUSTOM`
  - `subject`
  - `preheader`
  - `heading`
  - `body`
  - `ctaLabel`
  - `ctaUrl`
  - `footerText`
  - `senderDisplayName`
  - `replyToEmail`
  - `brandColor`
  - `buttonColor`
  - `fontFamily`: `JOST`, `INTER`, `SYSTEM`
  - `bannerImageUrl`
  - `logoImageId`
  - `recipientCount`
  - `sentAt`
  - `errorMessage`
  - `createdAt`
  - `updatedAt`

- `EmailMarketingLogo`
  - `id`
  - `organizationId`
  - `storeId`
  - `imageId`
  - `updatedById`
  - `createdAt`
  - `updatedAt`

Email Marketing keeps one saved logo per store. Reuploading a store logo replaces that store's selected logo record, while previous image assets may remain in managed storage. Campaigns can select one accessible store logo from the gallery and persist the selected `logoImageId` on send.

- `EmailCampaignRecipient`
  - `id`
  - `campaignId`
  - `customerId`
  - `email`
  - `status`: `PENDING`, `SENT`, `FAILED`, `SKIPPED`
  - `errorMessage`
  - `sentAt`
  - `createdAt`
  - `updatedAt`

The initial implementation can send synchronously in controlled batches if no queue is available, with campaign status/history persisted. The limitation should be documented.

## Affected Routes and Files

- `prisma/schema.prisma`
- new Prisma migration under `prisma/migrations`
- `src/server/services/email.ts`
- `src/server/services/emailMarketing.ts`
- `src/server/trpc/routers/emailMarketing.ts`
- `src/server/trpc/routers/_app.ts`
- `src/app/api/email-marketing/logo/route.ts`
- `src/app/(app)/operations/integrations/page.tsx`
- `src/app/(app)/operations/integrations/email-marketing/page.tsx`
- `src/lib/roleAccess.ts`
- `messages/en.json`
- `messages/ru.json`
- `messages/kg.json`
- `tests/integration/*`
- `tests/unit/*`

## Risks

- Campaign sends must not expose recipient emails to unauthorized roles.
- The app has no visible unsubscribe system. The first version should include a compliance footer placeholder and avoid claiming unsubscribe enforcement until it exists.
- Resend support currently has no reply-to field. Reply-to should only be exposed if the sender layer safely supports it.
- The integration must not allow arbitrary From addresses. Sender display name may be configurable, but the email address must be `no-reply@bazaar.kg`.
- Sending large audiences synchronously could block a request. If there is no queue, the implementation should batch conservatively and document remaining scale work.

## Validation Plan

- Test integration overview status for ready/not configured/missing sender configuration.
- Test admin/manager visibility and staff/cashier denial.
- Test audience counts include only selected-store customers with email.
- Test subject validation.
- Test rendered preview includes store/business branding and campaign fields.
- Test store logo gallery is store-scoped and preview does not render broken logo markup when no logo is uploaded.
- Test send creates campaign and recipient rows for the selected store only.
- Test sending uses `EMAIL_FROM=no-reply@bazaar.kg` and rejects unsafe/missing sender configuration.

## Implemented In This Slice

- Added `/operations/integrations/email-marketing` and an integration card visible only to admin/manager roles.
- Added `EmailCampaign` and `EmailCampaignRecipient` history models with store/org ownership, status, template, content, branding fields, and recipient status.
- Added `emailMarketing` tRPC router and service methods for overview, preview, queue send, and campaign history.
- Audience selection is store-scoped and only includes customers with an email address. Customers without email and customers in other stores are excluded.
- Customers with `emailMarketingUnsubscribedAt` set are excluded from all campaign audiences.
- Composer supports subject, preheader, heading, body, CTA label/URL, footer, templates, brand/button colors, font family, banner image URL, sender display name, reply-to, and live HTML preview.
- Added an email-marketing store logo gallery: one saved logo per accessible store, reupload replaces that store logo, and the selected logo is used in preview/send. If no logo exists, the email header falls back to the store name instead of rendering a broken image.
- Campaign sending enforces the fixed sender address `no-reply@bazaar.kg` through `MARKETING_EMAIL_FROM`; arbitrary From addresses are not accepted.
- Campaign sends are queued through the existing jobs framework. The job drains queued campaigns, records per-recipient sent/failed/skipped status, and includes per-recipient unsubscribe links.
- Sending requires a public app URL for uploaded logo and unsubscribe links; missing public URL fails before queueing instead of producing broken email assets.

## Limitations

- The unsubscribe flow is a minimal one-click public endpoint, not a full preference center with granular topics.
- Campaign delivery runs through the in-process jobs framework. For very large production audiences, a dedicated external queue/worker would still be safer.
- Sender display name is stored as campaign metadata; the email address remains fixed to `no-reply@bazaar.kg`.
