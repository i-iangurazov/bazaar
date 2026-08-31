import { readFile } from "node:fs/promises";
import path from "node:path";

import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

type MessageTree = { [key: string]: string | MessageTree };

const readWorkspaceMessages = async (locale: "en" | "ru" | "kg") => {
  const catalog = JSON.parse(await readSource(`messages/${locale}.json`)) as {
    emailMarketingWorkspace: MessageTree;
  };
  return catalog.emailMarketingWorkspace;
};

const flatten = (tree: MessageTree, prefix = "", result = new Map<string, string>()) => {
  for (const [key, value] of Object.entries(tree)) {
    const messageKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") result.set(messageKey, value);
    else flatten(value, messageKey, result);
  }
  return result;
};

const dynamicWorkspaceKeys = [
  ...["import", "order", "manual", "integration"].map((value) => `sources.${value}`),
  ...[
    "header",
    "hero",
    "text",
    "button",
    "products",
    "orderSummary",
    "promo",
    "divider",
    "footer",
  ].flatMap((value) => [`blocks.labels.${value}`, `blocks.descriptions.${value}`]),
  ...[
    "draft",
    "queued",
    "sending",
    "awaiting_events",
    "completed",
    "completed_with_errors",
    "cancelled",
    "sent",
    "partial",
    "failed",
  ].map((value) => `campaignStatus.${value}`),
  ...[
    "queued",
    "sending",
    "accepted",
    "deferred",
    "delivered",
    "bounced",
    "dropped",
    "suppressed",
    "complained",
    "failed",
    "cancelled",
    "pending",
    "sent",
    "skipped",
  ].map((value) => `recipientStatus.${value}`),
  ...["verified", "failed", "available", "not_configured", "pending", "pending_dns"].map(
    (value) => `senderStatus.${value}`,
  ),
  ...["order_created", "order_status_changed"].map((value) => `automationTrigger.${value}`),
  ...["active", "paused"].map((value) => `automationStatus.${value}`),
  ...["campaigns", "automations", "senders", "templates"].map((value) => `tabs.${value}`),
  ...["left", "center", "right"].map((value) => `alignment.${value}`),
  ...["small", "normal", "large", "huge"].map((value) => `fontSize.${value}`),
];

describe("email-marketing workspace localization", () => {
  it("owns every visible string through a complete EN/RU/KG message namespace", async () => {
    const source = await readSource(
      "src/app/(app)/operations/integrations/email-marketing/workspace.tsx",
    );
    const directKeys = Array.from(
      source.matchAll(/\b(?:tWorkspace|t)\(\s*["']([^"']+)["']/g),
      (match) => match[1],
    ).filter((key) => !key.startsWith("common."));
    const requiredKeys = new Set([...directKeys, ...dynamicWorkspaceKeys]);
    const localeMessages = await Promise.all(
      (["en", "ru", "kg"] as const).map(async (locale) => ({
        locale,
        messages: flatten(await readWorkspaceMessages(locale)),
      })),
    );

    expect(requiredKeys.size).toBeGreaterThan(300);
    for (const { locale, messages } of localeMessages) {
      for (const key of requiredKeys) {
        expect(messages.get(key), `${locale}: emailMarketingWorkspace.${key}`).toEqual(
          expect.stringMatching(/\S/),
        );
      }
      expect([...messages.keys()], `${locale} message-key parity`).toEqual([
        ...localeMessages[0].messages.keys(),
      ]);
    }
  });

  it("renders ICU variables and preserves literal email-template variables in every locale", async () => {
    for (const locale of ["en", "ru", "kg"] as const) {
      const messages = { emailMarketingWorkspace: await readWorkspaceMessages(locale) };
      const t = createTranslator({
        locale,
        messages,
        namespace: "emailMarketingWorkspace",
      }) as unknown as (key: string, values?: Record<string, string | number>) => string;

      expect(t("defaults.campaignName", { store: "Demo" })).toContain("Demo");
      expect(t("actions.cancelQueue", { count: 7 })).toContain("7");
      expect(t("defaults.customerGreeting")).toContain("{{customerName}}");
      expect(t("blockSettings.orderVariablesHint")).toContain("{{orderNumber}}");
    }
  });

  it("rejects the former Russian-only source and its hardcoded-copy exemption", async () => {
    const [source, checker] = await Promise.all([
      readSource("src/app/(app)/operations/integrations/email-marketing/workspace.tsx"),
      readSource("scripts/i18n-check.ts"),
    ]);

    expect(source).not.toMatch(/[А-Яа-яЁё]/);
    expect(source).not.toMatch(/(?:label|aria-label|placeholder|title)="[^"]+"/);
    expect(source).toContain('data-email-marketing-workspace="overview"');
    expect(source).toContain('data-email-marketing-workspace="builder"');
    expect(checker).not.toContain('"email-marketing"');
  });

  it("keeps representative rendered copy distinct instead of falling back to Russian", async () => {
    const [en, ru, kg] = await Promise.all(
      (["en", "ru", "kg"] as const).map(readWorkspaceMessages),
    );
    const sentinels = [
      "title",
      "subtitle",
      "actions.createCampaign",
      "builder.unavailableTitle",
      "campaigns.empty",
      "senders.configure",
      "automations.desktopOnly",
    ];
    const catalogs = { en: flatten(en), ru: flatten(ru), kg: flatten(kg) };

    expect([...catalogs.en.values()].join("\n")).not.toMatch(/[А-Яа-яЁё]/);
    for (const key of sentinels) {
      expect(catalogs.en.get(key), `English ${key}`).not.toBe(catalogs.ru.get(key));
      expect(catalogs.kg.get(key), `Kyrgyz ${key}`).not.toBe(catalogs.ru.get(key));
    }
  });
});
