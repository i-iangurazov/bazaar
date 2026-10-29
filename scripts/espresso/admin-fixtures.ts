/** Additive UI fixtures only; never reset the existing Espresso financial records. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { assertUxDatabase, uxEnvironment } from "../ux/environment";

if (process.env.UX_SUITE !== "espresso") throw new Error("Set UX_SUITE=espresso explicitly");
Object.assign(process.env, uxEnvironment());
assertUxDatabase();
const { prisma } = await import("../../src/server/db/prisma");
try {
  const organization = await prisma.organization.findFirstOrThrow({
    where: { name: "UI QA · Базар Маркет" },
  });
  const passwordHash = await bcrypt.hash("BazaarUxTest123!", 10);
  let starter = await prisma.organization.findFirst({
    where: { name: "UI QA · Espresso Starter" },
  });
  if (!starter)
    starter = await prisma.organization.create({
      data: { name: "UI QA · Espresso Starter", plan: "STARTER" },
    });
  let starterStore = await prisma.store.findFirst({ where: { organizationId: starter.id } });
  if (!starterStore) {
    starterStore = await prisma.store.create({
      data: { organizationId: starter.id, name: "Espresso Starter · тест", code: "ESPSTART" },
    });
  }
  const fixtures = [
    {
      email: "platform@espresso.example.invalid",
      name: "Espresso Platform QA",
      organizationId: organization.id,
      isOrgOwner: false,
    },
    {
      email: "starter@espresso.example.invalid",
      name: "Espresso Starter QA",
      organizationId: starter.id,
      isOrgOwner: true,
    },
  ];
  for (const fixture of fixtures) {
    let user = await prisma.user.findUnique({ where: { email: fixture.email } });
    if (!user)
      user = await prisma.user.create({
        data: {
          ...fixture,
          role: "ADMIN",
          passwordHash,
          emailVerifiedAt: new Date(),
          preferredLocale: "ru",
          themePreference: "DARK",
        },
      });
    assert.equal(user.organizationId, fixture.organizationId);
    assert.equal(user.role, "ADMIN");
    await prisma.userGuideState.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        completedToursJson: [],
        dismissedTipsJson: ["__guidance:tours_disabled__"],
      },
    });
  }
  const job = await prisma.deadLetterJob.upsert({
    where: { id: "espresso-ui-readonly-job" },
    update: {},
    create: {
      id: "espresso-ui-readonly-job",
      organizationId: organization.id,
      jobName: "espresso-ui-readonly",
      attempts: 1,
      lastError:
        "Synthetic UI fixture: inspect resolution, then cancel. No provider or queued handler.",
      retryAttemptId: "espresso-ui-uncertain-claim",
      retryStartedAt: new Date(),
    },
  });
  assert.equal(job.organizationId, organization.id);
  await mkdir("artifacts/ux/espresso", { recursive: true });
  const evidence = {
    database: "bazaar_espresso_ui",
    organizationId: organization.id,
    starterOrganizationId: starter.id,
    starterStoreId: starterStore.id,
    users: fixtures.map(({ email, organizationId }) => ({ email, organizationId })),
    deadLetterJobId: job.id,
    note: "Additive isolated QA fixtures; no queue, invoices, payments, feature flags, impersonation or financial changes.",
  };
  await writeFile(
    "artifacts/ux/espresso/admin-fixtures.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence));
} finally {
  await prisma.$disconnect();
}
