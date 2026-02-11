-- CreateTable
CREATE TABLE "UserGuideState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "completedToursJson" JSONB NOT NULL,
    "dismissedTipsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGuideState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserGuideState_userId_key" ON "UserGuideState"("userId");

-- CreateIndex
CREATE INDEX "UserGuideState_updatedAt_idx" ON "UserGuideState"("updatedAt");

-- AddForeignKey
ALTER TABLE "UserGuideState" ADD CONSTRAINT "UserGuideState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
