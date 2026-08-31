import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

type ReadinessMessages = {
  bakaiStoreSettings: { settings: { clearTokenWarning: string } };
  compliance: { cardSubtitle: string; subtitle: string };
  integrations: {
    oMarketPage: { credentials: { clearTokenWarning: string } };
    state: Record<"configured" | "loadError" | "loading" | "notConfigured", string>;
    status: Record<"loading" | "unavailable", string>;
  };
  mMarketSettings: { connection: { clearTokenWarning: string } };
  onboarding: {
    steps: { inventory: { description: string }; store: { description: string } };
    subtitle: string;
  };
  storesHardware: { connectorDeviceMissingHint: string };
};

const readMessages = (locale: "en" | "kg" | "ru") =>
  JSON.parse(readSource(`messages/${locale}.json`)) as ReadinessMessages;

const functionSection = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing section start: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing section end: ${end}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
};

describe("authenticated operations and settings production acceptance source", () => {
  it("keeps saved marketplace credentials masked until an explicit reveal", () => {
    const mMarketPage = readSource("src/app/(app)/operations/integrations/m-market/page.tsx");
    const bakaiPage = readSource("src/app/(app)/operations/integrations/bakai-store/page.tsx");
    const oMarketPage = readSource("src/app/(app)/operations/integrations/o-market/page.tsx");

    for (const page of [mMarketPage, bakaiPage, oMarketPage]) {
      expect(page).toContain("revealToken.useQuery(undefined, {");
      expect(page).toContain("enabled: false");
      expect(page).toContain("const revealSavedToken = async () =>");
      expect(page).toContain("revealTokenQuery.refetch()");
    }
    expect(mMarketPage).not.toContain(
      "enabled: canEdit && Boolean(settingsQuery.data?.integration.hasToken)",
    );
    expect(mMarketPage).not.toContain("revealTokenQuery.data?.apiToken");
    expect(mMarketPage).toContain("variables.clearToken || variables.apiToken");
    expect(bakaiPage).toContain("variables.clearToken || variables.apiToken");
    expect(oMarketPage).toContain('setApiToken("")');
  });

  it("returns credential-state booleans from normal settings responses, never plaintext", () => {
    const mMarketService = readSource("src/server/services/mMarket.ts");
    const bakaiService = readSource("src/server/services/bakaiStore.ts");
    const oMarketService = readSource("src/server/services/oMarket.ts");

    const mMarketSettings = functionSection(
      mMarketService,
      "export const getMMarketSettings",
      "export const getMMarketSavedToken",
    );
    const bakaiSettings = functionSection(
      bakaiService,
      "export const getBakaiStoreSettings",
      "export const getBakaiStoreSavedToken",
    );
    const oMarketSettings = functionSection(
      oMarketService,
      "export const getOMarketSettings",
      "export const getOMarketSavedToken",
    );

    expect(mMarketSettings).toContain("hasToken: Boolean(integration.apiTokenEncrypted)");
    expect(bakaiSettings).toContain("hasApiToken: Boolean(integration?.apiTokenEncrypted)");
    expect(oMarketSettings).toContain("hasToken: Boolean(integration?.apiTokenEncrypted)");
    for (const settingsSection of [mMarketSettings, bakaiSettings, oMarketSettings]) {
      expect(settingsSection).not.toContain("decryptToken(");
      expect(settingsSection).not.toMatch(/apiToken:\s*integration/);
    }
  });

  it("requires a consequence warning before marketplace disconnects", () => {
    const pages = [
      readSource("src/app/(app)/operations/integrations/m-market/page.tsx"),
      readSource("src/app/(app)/operations/integrations/bakai-store/page.tsx"),
      readSource("src/app/(app)/operations/integrations/o-market/page.tsx"),
    ];

    for (const page of pages) {
      expect(page).toContain("await confirm({");
      expect(page).toContain("clearTokenWarning");
      expect(page).toContain('confirmVariant: "danger"');
      expect(page).toContain("{confirmDialog}");
    }

    for (const locale of ["en", "ru", "kg"] as const) {
      const messages = readMessages(locale);
      const warnings = [
        messages.mMarketSettings.connection.clearTokenWarning,
        messages.bakaiStoreSettings.settings.clearTokenWarning,
        messages.integrations.oMarketPage.credentials.clearTokenWarning,
      ] as string[];
      for (const warning of warnings) {
        expect(warning.length).toBeGreaterThan(70);
        expect(warning.toLowerCase()).toMatch(/bazaar/);
      }
    }
  });

  it("distinguishes integration loading, error, empty, and configured states", () => {
    const overview = readSource("src/app/(app)/operations/integrations/page.tsx");
    expect(overview).toContain("const withQueryStatus = (");
    expect(overview).toContain('status: t("status.unavailable")');
    expect(overview).toContain('if (query.error) return t("state.loadError")');
    expect(overview).toContain('t("state.notConfigured")');
    expect(overview).toContain('t("state.configured")');

    for (const locale of ["en", "ru", "kg"] as const) {
      const integrations = readMessages(locale).integrations;
      expect(integrations.status.loading).toBeTruthy();
      expect(integrations.status.unavailable).toBeTruthy();
      expect(integrations.state.loading).toBeTruthy();
      expect(integrations.state.loadError.length).toBeGreaterThan(50);
      expect(integrations.state.notConfigured.length).toBeGreaterThan(50);
      expect(integrations.state.configured.length).toBeGreaterThan(50);
    }
  });

  it("guards rapid personal-profile submissions synchronously", () => {
    const profilePage = readSource("src/app/(app)/settings/profile/page.tsx");
    expect(profilePage).toContain("const personalSubmitInFlightRef = useRef(false)");
    expect(profilePage).toContain("if (personalSubmitInFlightRef.current)");
    expect(profilePage).toContain("personalSubmitInFlightRef.current = true");
    expect(profilePage).toContain("personalSubmitInFlightRef.current = false");
    expect(profilePage).toContain("personalForm.handleSubmit(handlePersonalSubmit)");
    expect(profilePage).toContain(
      '<Label htmlFor="profile-account-email">{t("personal.email")}</Label>',
    );
    expect(profilePage).toContain('id="profile-account-email"');
    expect(profilePage.match(/<SelectTrigger aria-label=/g)).toHaveLength(6);
  });

  it("keeps onboarding, profile, compliance, and hardware policy explicit", () => {
    const onboardingRouter = readSource("src/server/trpc/routers/onboarding.ts");
    const authenticatedFixture = readSource("scripts/playwright-authenticated-fixture.ts");
    const orgSettingsRouter = readSource("src/server/trpc/routers/orgSettings.ts");
    const complianceRouter = readSource("src/server/trpc/routers/compliance.ts");
    const storesRouter = readSource("src/server/trpc/routers/stores.ts");

    expect(onboardingRouter).toContain("get: adminProcedure");
    expect(onboardingRouter).toContain("completeStep: adminProcedure");
    expect(onboardingRouter).toContain("skipStep: adminProcedure");
    expect(authenticatedFixture).toContain("legalEntityType: LegalEntityType.IP");
    expect(authenticatedFixture).toContain('legalName: "QA-BAZAAR Primary Store Legal Entity"');
    expect(authenticatedFixture).toContain("legalEntityType: store.legalEntityType");
    expect(authenticatedFixture).toContain("legalName: store.legalName");
    expect(orgSettingsRouter).toContain("getBusinessProfile: adminOrOrgOwnerProcedure");
    expect(orgSettingsRouter).toContain("updateBusinessProfile: adminOrOrgOwnerProcedure");
    expect(complianceRouter).toContain("getStore: managerProcedure");
    expect(complianceRouter).toContain("updateStore: adminProcedure");
    expect(storesRouter).toContain("hardware: protectedProcedure");
    expect(storesRouter).toContain("updateHardware: printingProcedure");

    const english = readMessages("en");
    const usefulCopy = [
      english.onboarding.subtitle,
      english.onboarding.steps.store.description,
      english.onboarding.steps.inventory.description,
      english.compliance.subtitle,
      english.compliance.cardSubtitle,
      english.storesHardware.connectorDeviceMissingHint,
    ] as string[];
    for (const copy of usefulCopy) {
      expect(copy.length).toBeGreaterThan(30);
      expect(copy).not.toMatch(/\boverview\b|\bhint\b|\bdescription\b/i);
    }
  });
});
