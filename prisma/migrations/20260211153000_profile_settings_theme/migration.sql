CREATE TYPE "ThemePreference" AS ENUM ('LIGHT', 'DARK');

ALTER TABLE "User"
ADD COLUMN "phone" TEXT,
ADD COLUMN "jobTitle" TEXT,
ADD COLUMN "themePreference" "ThemePreference" NOT NULL DEFAULT 'LIGHT';
