INSERT INTO "Organization" ("id", "name", "createdAt", "updatedAt") VALUES
  ('email_org_1', 'Email migration org', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_org_2', 'Other email org', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "Store" ("id", "organizationId", "name", "code", "createdAt", "updatedAt") VALUES
  ('email_store_1', 'email_org_1', 'Email Store', 'EMAIL1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_store_2', 'email_org_1', 'Other Store', 'EMAIL2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_store_3', 'email_org_2', 'Other Org Store', 'EMAIL3', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "Customer" (
  "id", "organizationId", "storeId", "name", "email", "createdAt", "updatedAt"
) VALUES
  ('email_customer_pending', 'email_org_1', 'email_store_1', 'Pending', 'pending@example.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_customer_sent', 'email_org_1', 'email_store_1', 'Sent', 'sent@example.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_customer_failed', 'email_org_1', 'email_store_1', 'Failed', 'failed@example.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_customer_unsub', 'email_org_1', 'email_store_1', 'Unsub', 'unsub@example.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_customer_suppressed', 'email_org_1', 'email_store_1', 'Suppressed', 'suppressed@example.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_customer_dropped', 'email_org_1', 'email_store_1', 'Dropped', 'dropped@example.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_customer_complained', 'email_org_1', 'email_store_1', 'Complained', 'suppress@example.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_customer_bounced', 'email_org_1', 'email_store_1', 'Bounced', 'bounce@example.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_customer_mismatch', 'email_org_1', 'email_store_1', 'Mismatch', 'mismatch@example.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "EmailCampaign" (
  "id", "organizationId", "storeId", "status", "name", "subject", "body",
  "recipientCount", "sentCount", "deliveredCount", "failedCount", "createdAt", "updatedAt"
) VALUES (
  'email_campaign_legacy', 'email_org_1', 'email_store_1', 'PARTIAL', 'Legacy',
  'Legacy campaign', 'Legacy body', 9, 5, 0, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "EmailCampaignRecipient" (
  "id", "organizationId", "campaignId", "customerId", "email", "status",
  "providerStatus", "errorMessage", "sentAt", "bouncedAt", "complainedAt",
  "createdAt", "updatedAt"
) VALUES
  ('email_recipient_pending', 'email_org_1', 'email_campaign_legacy', 'email_customer_pending', 'pending@example.com', 'PENDING', NULL, NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_recipient_sent', 'email_org_1', 'email_campaign_legacy', 'email_customer_sent', 'sent@example.com', 'SENT', 'sent', NULL, CURRENT_TIMESTAMP, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_recipient_failed', 'email_org_1', 'email_campaign_legacy', 'email_customer_failed', 'failed@example.com', 'FAILED', 'failed', 'permanent provider rejection', CURRENT_TIMESTAMP, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_recipient_unsub', 'email_org_1', 'email_campaign_legacy', 'email_customer_unsub', 'unsub@example.com', 'SKIPPED', NULL, 'recipient unsubscribed', NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_recipient_suppressed', 'email_org_1', 'email_campaign_legacy', 'email_customer_suppressed', 'suppressed@example.com', 'SKIPPED', NULL, 'provider suppressed address', NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_recipient_dropped', 'email_org_1', 'email_campaign_legacy', 'email_customer_dropped', 'dropped@example.com', 'SENT', 'dropped', 'provider dropped address', CURRENT_TIMESTAMP, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_recipient_complained', 'email_org_1', 'email_campaign_legacy', 'email_customer_complained', ' Suppress@Example.com ', 'SENT', 'complained', 'spam complaint', CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_recipient_bounced', 'email_org_1', 'email_campaign_legacy', 'email_customer_bounced', 'BOUNCE@example.com', 'FAILED', 'bounced', 'unknown user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('email_recipient_mismatch', 'email_org_2', 'email_campaign_legacy', 'email_customer_mismatch', 'mismatch@example.com', 'PENDING', NULL, NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
