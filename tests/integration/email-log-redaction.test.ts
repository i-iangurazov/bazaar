import { CustomerOrderEmailStatus, CustomerOrderEmailType } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logSpy = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@/server/logging", () => ({
  getLogger: () => logSpy,
}));

import { prisma } from "@/server/db/prisma";
import {
  sendEmailBatch,
  sendVerificationEmail,
} from "@/server/services/email";
import { sendOrderConfirmationEmail } from "@/server/services/orderEmails";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const previousProvider = process.env.EMAIL_PROVIDER;

const loggedOutput = () => JSON.stringify(logSpy.info.mock.calls);

describeDb("HARD-A3-031 log email redaction", () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.EMAIL_PROVIDER = "log";
    logSpy.info.mockClear();
  });

  afterEach(() => {
    if (previousProvider === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = previousProvider;
  });

  it("logs only safe signup-verification metadata", async () => {
    const email = "private.signup+secret@example.com";
    const token = "verification-token-HARD-A3-031-secret";
    const verifyLink = `https://app.example.com/verify/${token}`;

    await sendVerificationEmail({ email, verifyLink, locale: "en" });

    const output = loggedOutput();
    expect(output).not.toContain(email);
    expect(output).not.toContain(token);
    expect(output).not.toContain(verifyLink);
    expect(output).not.toContain("Thanks for registering");
    expect(logSpy.info).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "log",
        messageCategory: "signup_verification",
        recipientCount: 1,
        recipientDomain: "example.com",
        recipientHash: expect.stringMatching(/^[a-f0-9]{16}$/),
        subjectHash: expect.stringMatching(/^[a-f0-9]{16}$/),
      }),
      "email delivery fallback",
    );
  });

  it("redacts order content while preserving the authorized DB email-log contract", async () => {
    const { org, store, product, adminUser } = await seedBase();
    const privateEmail = "private.order@example.com";
    const privateName = "Highly Private Customer Name";
    const order = await prisma.customerOrder.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        number: "SO-PRIVATE-A3-031",
        customerName: privateName,
        customerEmail: privateEmail,
        subtotalKgs: 125,
        totalKgs: 125,
        createdById: adminUser.id,
        updatedById: adminUser.id,
        lines: {
          create: {
            productId: product.id,
            variantKey: "BASE",
            qty: 1,
            unitPriceKgs: 125,
            lineTotalKgs: 125,
          },
        },
      },
    });

    await sendOrderConfirmationEmail({
      organizationId: org.id,
      customerOrderId: order.id,
      triggeredById: adminUser.id,
    });

    const output = loggedOutput();
    expect(output).not.toContain(privateEmail);
    expect(output).not.toContain(privateName);
    expect(output).not.toContain(order.number);
    expect(output).not.toContain("125");
    expect(logSpy.info).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "log",
        messageCategory: "order_confirmation",
        recipientCount: 1,
        recipientDomain: "example.com",
      }),
      "email delivery fallback",
    );
    expect(
      await prisma.customerOrderEmailLog.findFirst({
        where: { customerOrderId: order.id },
      }),
    ).toMatchObject({
      type: CustomerOrderEmailType.CONFIRMATION,
      status: CustomerOrderEmailStatus.SENT,
      recipientEmail: privateEmail,
      provider: "log",
    });
  });

  it("redacts every campaign batch recipient, subject, body, and link", async () => {
    const token = "campaign-token-HARD-A3-031-secret";
    const recipients = ["campaign.one@example.com", "campaign.two@shop.example"];
    const subjects = ["Private campaign subject A", "Private campaign subject B"];

    await sendEmailBatch(
      recipients.map((to, index) => ({
        to,
        subject: subjects[index]!,
        text: `Private body ${token}`,
        html: `<a href="https://private.example/${token}">Private customer body</a>`,
        tags: [{ name: "category", value: "email_marketing" }],
      })),
    );

    const output = loggedOutput();
    for (const value of [...recipients, ...subjects, token, "Private customer body"]) {
      expect(output).not.toContain(value);
    }
    expect(logSpy.info).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "log",
        recipientCount: 2,
        recipientDomains: ["example.com", "shop.example"],
        messageCategories: ["email_marketing"],
        subjectHashes: [
          expect.stringMatching(/^[a-f0-9]{16}$/),
          expect.stringMatching(/^[a-f0-9]{16}$/),
        ],
      }),
      "email batch delivery fallback",
    );
  });
});
