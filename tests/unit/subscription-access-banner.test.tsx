// @vitest-environment jsdom
import type * as NextIntlModule from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";
import { formatDateTime } from "@/lib/i18nFormat";

const state = vi.hoisted(() => ({
  locale: "ru" as "ru" | "kg" | "en",
  path: "/pos",
  query: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
vi.mock("next-intl", async (importOriginal) => {
  const { createTranslator } = await importOriginal<typeof NextIntlModule>();
  return {
    useLocale: () => state.locale,
    useTranslations: (namespace: string) => {
      if (!["billing.accessNotice", "billing.trial"].includes(namespace))
        throw new Error(namespace);
      const copy =
        namespace === "billing.trial"
          ? { ru, kg, en }[state.locale].billing.trial
          : { ru, kg, en }[state.locale].billing.accessNotice;
      return createTranslator({
        locale: state.locale,
        messages: { section: copy },
        namespace: "section",
      });
    },
  };
});
vi.mock("@/lib/trpc", () => ({ trpc: { billing: { features: { useQuery: state.query } } } }));
import {
  SubscriptionAccessBanner,
  SubscriptionAccessNotice,
} from "@/components/billing/subscription-access-banner";

const graceEndsAt = new Date("2027-02-08T09:00:00.000Z");
const modern = {
  billingCatalogVersion: "2026-11",
  lifetimeAccess: false,
  subscriptionStatus: "ACTIVE",
  access: { inGrace: true, hasAccess: true, graceEndsAt },
};
const renderNotice = (
  value: ComponentProps<typeof SubscriptionAccessNotice>["state"] = modern,
  canManage = true,
  showBillingLink = true,
) => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(
    <SubscriptionAccessNotice
      state={value}
      canManage={canManage}
      showBillingLink={showBillingLink}
    />,
  );
  return root;
};
beforeEach(() => {
  state.locale = "ru";
  state.path = "/pos";
  state.query.mockReset();
});
describe("non-blocking subscription grace and viewing notices", () => {
  it.each(["ru", "kg", "en"] as const)(
    "distinguishes an unpaid expired trial from a paid grace period in %s",
    (locale) => {
      state.locale = locale;
      const value = {
        ...modern,
        trialActive: false,
        trialEndsAt: new Date(Date.now() - 86_400_000),
        trialOffer: { days: 7, previewPlan: "ENTERPRISE" },
        access: { inGrace: false, hasAccess: false, graceEndsAt: null },
      };
      const root = renderNotice(value);
      expect(
        root.querySelector('[data-subscription-access-notice="trial-expired"]'),
      ).not.toBeNull();
      expect(root.textContent).toContain(
        { ru, kg, en }[locale].billing.accessNotice.trialExpiredTitle,
      );
      expect(root.textContent).toContain(
        { ru, kg, en }[locale].billing.accessNotice.trialExpiredDescription,
      );
      expect(root.textContent).not.toContain(
        { ru, kg, en }[locale].billing.accessNotice.graceTitle,
      );
      expect(root.querySelector('a[href="/billing"]')).not.toBeNull();
    },
  );
  it.each(["ru", "kg", "en"] as const)(
    "explains the current trial and exact end in %s",
    (locale) => {
      state.locale = locale;
      const value = {
        ...modern,
        trialActive: true,
        trialEndsAt: new Date(Date.now() + 6 * 86_400_000),
        trialOffer: { days: 7, previewPlan: "BUSINESS" },
        access: { ...modern.access, inGrace: false, hasAccess: true },
      };
      const root = renderNotice(value);
      expect(root.querySelector('[data-subscription-access-notice="trial"]')).not.toBeNull();
      expect(root.textContent).toContain(formatDateTime(value.trialEndsAt, locale));
      expect(root.textContent).toContain({ ru, kg, en }[locale].billing.trial.scope);
      expect(root.textContent).not.toMatch(/undefined|\{count|\{date/);
      expect(root.querySelector('a[href="/billing"]')).not.toBeNull();
    },
  );
  it.each(["ru", "kg", "en"] as const)(
    "renders a concrete grace deadline and billing link in %s",
    (locale) => {
      state.locale = locale;
      const root = renderNotice();
      expect(root.querySelector('[data-subscription-access-notice="grace"]')).not.toBeNull();
      expect(root.querySelector('[role="status"]')).not.toBeNull();
      expect(root.textContent).toContain(formatDateTime(graceEndsAt, locale));
      expect(root.querySelector('a[href="/billing"]')).not.toBeNull();
      expect(root.textContent).not.toMatch(/undefined|\{date\}/);
    },
  );
  it.each(["ru", "kg", "en"] as const)(
    "explains retained history and exports in expired %s access",
    (locale) => {
      state.locale = locale;
      const root = renderNotice({
        ...modern,
        access: { ...modern.access, inGrace: false, hasAccess: false },
      });
      expect(root.querySelector('[data-subscription-access-notice="read-only"]')).not.toBeNull();
      expect(root.textContent).toContain(
        { ru, kg, en }[locale].billing.accessNotice.expiredDescription,
      );
    },
  );
  it.each([
    { ...modern, billingCatalogVersion: "2026-10" },
    { ...modern, lifetimeAccess: true },
    { ...modern, subscriptionStatus: "CANCELED" },
    { ...modern, access: { ...modern.access, inGrace: false, hasAccess: true } },
  ])("leaves legacy, lifetime, canceled and currently active contracts unchanged", (value) => {
    expect(renderNotice(value).innerHTML).toBe("");
  });
  it("directs staff to an administrator rather than an inaccessible billing page", () => {
    const root = renderNotice(modern, false);
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toContain(ru.billing.accessNotice.askOwner);
  });
  it("keeps the same notice on billing without a self-referencing renewal button", () => {
    expect(renderNotice(modern, true, false).querySelector("a")).toBeNull();
    expect(renderNotice(modern, true, false).querySelector('[role="status"]')).not.toBeNull();
  });
  it.each([
    { isLoading: true, isError: false },
    { isLoading: false, isError: true },
  ])("does not replace the workspace or guess status during a loading/error result %j", (query) => {
    state.query.mockReturnValue({ ...query, data: modern });
    expect(renderToStaticMarkup(<SubscriptionAccessBanner canManage />)).toBe("");
  });
  it("avoids duplicate queries/notices on billing and polls only current non-lifetime contracts", () => {
    state.path = "/billing";
    state.query.mockReturnValue({ isLoading: false, isError: false, data: modern });
    expect(renderToStaticMarkup(<SubscriptionAccessBanner canManage />)).toBe("");
    const options = state.query.mock.calls[0][1];
    expect(options.enabled).toBe(false);
    expect(options.refetchInterval(modern)).toBe(60000);
    expect(options.refetchInterval({ ...modern, billingCatalogVersion: "2026-10" })).toBe(false);
    expect(options.refetchInterval({ ...modern, lifetimeAccess: true })).toBe(false);
    expect(options.refetchInterval({ ...modern, subscriptionStatus: "CANCELED" })).toBe(false);
  });
});
