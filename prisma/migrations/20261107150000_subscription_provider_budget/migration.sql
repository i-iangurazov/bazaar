BEGIN;
ALTER TABLE "SubscriptionUsageReservation" ADD COLUMN "actualUnits" INTEGER;
ALTER TABLE "SubscriptionUsageReservation" ADD CONSTRAINT "SubscriptionUsageReservation_actual_units_check" CHECK ("actualUnits" IS NULL OR "actualUnits" >= 0);
COMMIT;
