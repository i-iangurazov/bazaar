INSERT INTO "EmailCampaign" (
  "id", "organizationId", "storeId", "status", "name", "subject", "body",
  "recipientCount", "sentCount", "deliveredCount", "failedCount", "createdAt", "updatedAt"
) VALUES (
  'email_campaign_tenant_mismatch', 'email_org_2', 'email_store_1', 'DRAFT',
  'Tenant mismatch', 'Tenant mismatch', 'Tenant mismatch', 0, 0, 0, 0,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);
