// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";
import { PLAN_FEATURE_CODES } from "@/lib/billing/plans";
import { getFeatureLockedErrorKey } from "@/server/billing/planCatalog";
import { featureFromErrorDetails, featureLockError, isTranslatedFeatureLock } from "@/lib/billing/featureLocks";
import { translateError } from "@/lib/translateError";

const state = vi.hoisted(() => ({ role: "ADMIN", query: vi.fn() }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { role: state.role } } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/products" }));
vi.mock("@/lib/trpc", () => ({ trpc: { billing: { features: { useQuery: state.query } } } }));
import { SubscriptionFeatureLock, SubscriptionFeatureAvailability } from "@/components/billing/subscription-feature-lock";
import { SubscriptionPreparationNotice } from "@/components/billing/subscription-preparation-notice";
import { QueryErrorState } from "@/components/query-error-state";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

beforeEach(() => {
  state.role = "ADMIN";
  state.query.mockReturnValue({ data: { plan: "STARTER", featurePlans: {} } });
});
afterEach(cleanup);

function view(node: React.ReactNode, locale: "ru" | "kg" | "en" = "ru") {
  const copy = { ru, kg, en }[locale];
  return renderToStaticMarkup(<NextIntlClientProvider locale={locale}
    messages={{ billing: copy.billing, errors: copy.errors, common: copy.common }} timeZone="Asia/Bishkek">
    {node}
  </NextIntlClientProvider>);
}

describe("plan-lock presentation and exact failure classification", () => {
  it.each(PLAN_FEATURE_CODES)("covers the server's plan failure for %s", feature => {
    expect(featureLockError(getFeatureLockedErrorKey(feature))).not.toBeNull();
    expect(featureLockError(`errors.${getFeatureLockedErrorKey(feature)}`)).not.toBeNull();
  });
  it.each(["forbidden", "unauthorized", "trialExpired", "subscriptionInactive", "billingUsageLimitReached",
    "billingUsageInProgress", "whatsappProviderUnavailable", "paymentFailed"])("never turns %s into a feature upsell", key => {
    expect(featureLockError(key)).toBeNull();
  });
  it.each(["ru", "kg", "en"] as const)("shows the feature, current plan, required plans and direct CTA in %s", locale => {
    const copy = { ru, kg, en }[locale];
    const html = view(<SubscriptionFeatureLock feature="analytics" currentPlan="STARTER" canManage
      availablePlans={["BUSINESS", "ENTERPRISE"]} />, locale);
    expect(html).toContain(copy.billing.features.analytics);
    expect(html).toContain(copy.billing.plans.starter.name);
    expect(html).toContain(copy.billing.plans.business.name);
    expect(html).toContain(copy.billing.plans.enterprise.name);
    expect(html).toContain('href="/billing#plans"');
    expect(html).not.toMatch(/undefined|\{feature\}|\{plan/);
  });
  it("does not offer unavailable billing access to ordinary staff", () => {
    const html = view(<SubscriptionFeatureLock feature="bundles" currentPlan="BUSINESS" canManage={false}
      availablePlans={["ENTERPRISE"]} />);
    expect(html).toContain(ru.billing.featureAskOwner);
    expect(html).not.toContain('href="/billing');
  });
  it("does not claim an unsupported integration can be purchased", () => {
    const html = view(<SubscriptionFeatureLock feature="kkm" currentPlan="ENTERPRISE" canManage availablePlans={[]} />);
    expect(html).toContain(ru.billing.featureLock.notOffered);
    expect(html).not.toContain(ru.billing.featureLock.availableIn);
  });
  it("distinguishes a preview exclusion from a purchased Starter restriction", () => {
    const html = view(<SubscriptionFeatureLock feature="emailMarketing" currentPlan="STARTER" canManage isTrial
      availablePlans={["BUSINESS", "ENTERPRISE"]} />);
    expect(html).toContain(ru.billing.featureLock.unavailableInTrial.replace("{feature}", ru.billing.features.emailMarketing));
    expect(html).not.toContain(ru.billing.featureLock.unavailableOnPlan.replace("{feature}", ru.billing.features.emailMarketing)
      .replace("{plan}", ru.billing.plans.starter.name));
  });
  it("keeps locked secondary actions discoverable without hiding existing paid actions", () => {
    const html = view(<SubscriptionFeatureAvailability features={["bundles", "imports"]}
      flags={{ bundles: false, imports: true }} canManage currentPlan="BUSINESS" featurePlans={{ bundles: ["ENTERPRISE"] }} />);
    expect(html).toContain("<details");
    expect(html).toContain('data-subscription-feature-lock="bundles"');
    expect(html).not.toContain('data-subscription-feature-lock="imports"');
    expect(view(<SubscriptionFeatureAvailability features={["imports"]} flags={{ imports: true }} canManage />)).toBe("");
  });
  it.each(["ru", "kg", "en"] as const)("recognizes localized mutation plan failures in %s", locale => {
    const messages = { ru, kg, en }[locale].errors;
    const t = Object.assign((key: string) => messages[key as keyof typeof messages] as string,
      { has: (key: string) => Object.hasOwn(messages, key) });
    for (const feature of PLAN_FEATURE_CODES)
      expect(isTranslatedFeatureLock(t(getFeatureLockedErrorKey(feature)), t)).toBe(true);
    expect(isTranslatedFeatureLock(t("forbidden"), t)).toBe(false);
    expect(isTranslatedFeatureLock(t("billingUsageLimitReached"), t)).toBe(false);
  });
  it("turns a query plan failure into a contextual upgrade instead of a futile retry", () => {
    state.query.mockReturnValue({ data: { plan: "BUSINESS", featurePlans: { bundles: ["ENTERPRISE"] } } });
    const html = view(<QueryErrorState error={{ message: "featureLockedBundles" } as never} onRetry={() => undefined} />);
    expect(html).toContain('data-subscription-feature-lock="bundles"');
    expect(html).toContain('href="/billing#plans"');
    expect(html).not.toContain(ru.common.tryAgain);
  });
  it("uses a validated feature identifier from a generic server plan error", () => {
    state.query.mockReturnValue({ data: { plan: "STARTER", featurePlans: { bulkAiContent: ["BUSINESS", "ENTERPRISE"] } } });
    const html = view(<QueryErrorState error={{ message: "featureLockedPlan", data: { details: { feature: "bulkAiContent" } } } as never}
      onRetry={() => undefined} />);
    expect(html).toContain('data-subscription-feature-lock="bulkAiContent"');
    expect(html).toContain(ru.billing.features.bulkAiContent);
    expect(html).toContain(ru.billing.plans.business.name);
  });
  it.each([null, {}, { feature: "madeUpFeature" }, { feature: ["analytics"] }, ["analytics"]])(
    "ignores invalid feature metadata %j", details => expect(featureFromErrorDetails(details)).toBeNull(),
  );
  it.each(["ru", "kg", "en"] as const)("names generic mutation plan errors and preserves their pricing CTA in %s", locale => {
    const messages = { ru, kg, en }[locale].errors;
    const lookup = (key: string): unknown => key.split(".").reduce<unknown>((value, segment) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)[segment] : undefined, messages);
    const t = Object.assign((key: string) => String(lookup(key) ?? key),
      { has: (key: string) => typeof lookup(key) === "string" });
    const named = translateError(t, { message: "featureLockedPlan", data: { details: { feature: "bulkAiContent" } } } as never);
    expect(named).toBe(`${messages.featureNames.bulkAiContent}: ${messages.featureLockedPlan}`);
    expect(isTranslatedFeatureLock(named, t)).toBe(true);
    const denied = translateError(t, { message: "forbidden", data: { code: "FORBIDDEN", details: { feature: "bulkAiContent" } } } as never);
    expect(denied).toBe(messages.forbidden);
    expect(isTranslatedFeatureLock(denied, t)).toBe(false);
    expect(isTranslatedFeatureLock(`Unknown feature: ${messages.featureLockedPlan}`, t)).toBe(false);
    expect(isTranslatedFeatureLock(`${messages.featureNames.bulkAiContent}: ${messages.billingUsageLimitReached}`, t)).toBe(false);
  });
  it("explains a scheduled-plan restriction without claiming the current plan lacks it", () => {
    const html = view(<QueryErrorState error={{ message: "billingScheduledFeatureRestriction" } as never}
      onRetry={() => undefined} />);
    expect(html).toContain(ru.errors.billingScheduledFeatureRestriction);
    expect(html).toContain('href="/billing#plans"');
    expect(html).not.toContain("Эта функция недоступна на тарифе");
  });
  it.each(["ADMIN", "STAFF"])("gives a mutation plan-failure toast the correct next step for %s", role => {
    state.role = role;
    function Trigger() {
      const { toast } = useToast();
      return <button onClick={() => toast({ variant: "error", description: ru.errors.featureLockedBundles })}>Trigger</button>;
    }
    render(<NextIntlClientProvider locale="ru" messages={{ billing: ru.billing, common: ru.common, errors: ru.errors }} timeZone="Asia/Bishkek">
      <TooltipProvider><ToastProvider><Trigger /></ToastProvider></TooltipProvider>
    </NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    if (role === "ADMIN") expect(screen.getByRole("link", { name: ru.billing.viewPlans }).getAttribute("href")).toBe("/billing#plans");
    else {
      expect(screen.queryByRole("link", { name: ru.billing.viewPlans })).toBeNull();
      expect(screen.getByRole("alert").textContent).toContain(ru.billing.featureAskOwner);
    }
  });
  it("gives concrete preparation links without exposing unknown provider or module text", () => {
    const html = view(<SubscriptionPreparationNotice modules={["bundles", "loyalty", "raw-provider-secret", "bundles"]} />);
    expect(html).toContain(ru.billing.featureLock.preparation.bundles);
    expect(html).toContain('href="/settings/loyalty"');
    expect(html).toContain('href="/products"');
    expect(html).not.toContain("raw-provider-secret");
    expect(html.split(ru.billing.featureLock.preparation.bundles)).toHaveLength(2);
  });
});
