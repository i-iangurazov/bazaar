-- Allow verified accounts to complete business registration before being attached to an organization.
ALTER TABLE "User"
  ALTER COLUMN "organizationId" DROP NOT NULL;
