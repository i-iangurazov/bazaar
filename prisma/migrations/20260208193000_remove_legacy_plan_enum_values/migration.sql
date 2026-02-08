-- Remove legacy OrganizationPlan values (TRIAL/PRO) and keep only STARTER/BUSINESS/ENTERPRISE.
CREATE TYPE "OrganizationPlan_new" AS ENUM ('STARTER', 'BUSINESS', 'ENTERPRISE');

ALTER TABLE "Organization"
  ALTER COLUMN "plan" DROP DEFAULT;

ALTER TABLE "Organization"
  ALTER COLUMN "plan" TYPE "OrganizationPlan_new"
  USING (
    CASE
      WHEN "plan"::text = 'TRIAL' THEN 'STARTER'
      WHEN "plan"::text = 'PRO' THEN 'BUSINESS'
      WHEN "plan"::text = 'STARTER' THEN 'STARTER'
      WHEN "plan"::text = 'BUSINESS' THEN 'BUSINESS'
      WHEN "plan"::text = 'ENTERPRISE' THEN 'ENTERPRISE'
      ELSE 'STARTER'
    END
  )::"OrganizationPlan_new";

ALTER TABLE "Organization"
  ALTER COLUMN "plan" SET DEFAULT 'STARTER'::"OrganizationPlan_new";

DROP TYPE "OrganizationPlan";
ALTER TYPE "OrganizationPlan_new" RENAME TO "OrganizationPlan";
