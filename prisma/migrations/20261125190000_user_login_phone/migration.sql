CREATE TABLE "UserLoginPhone" (
  "userId" TEXT NOT NULL,
  "phone" VARCHAR(16) NOT NULL,
  CONSTRAINT "UserLoginPhone_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "UserLoginPhone_phone_e164" CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT "UserLoginPhone_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UserLoginPhone_phone_key" ON "UserLoginPhone"("phone");
