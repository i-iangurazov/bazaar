import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({ locale: "ru", token: null as null | object }));
vi.mock("next-intl/server", () => ({ getLocale: async () => state.locale }));
vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new Error(`redirect:${destination}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/server/auth/token", () => ({ getServerAuthToken: async () => state.token }));
vi.mock("@/components/help/HelpGuidePage", () => ({ HelpGuidePage: () => null }));
vi.mock("@/components/marketing/MarketingLanding", () => ({ MarketingLanding: () => null }));
import GuidePage, { generateMetadata } from "@/app/(guide)/help/[category]/[guide]/page";
import LegacyHome from "@/app/[locale]/page";
import LegacyRoute from "@/app/[locale]/[...slug]/page";
import { getHelpGuide } from "@/content/help/catalog";
import { MarketingLanding } from "@/components/marketing/MarketingLanding";

afterEach(() => {
  state.token = null;
  state.locale = "ru";
});

describe("public guide language and legacy entry points", () => {
  it.each(["ru", "kg", "en"] as const)(
    "keeps %s article metadata and structured steps in the displayed language",
    async (locale) => {
      state.locale = locale;
      const params = { category: "inventory", guide: "receiving" };
      const guide = getHelpGuide(params.category, params.guide)!;
      const page = await GuidePage({ params: Promise.resolve(params), searchParams: Promise.resolve({ from: "/inventory/receiving" }) });
      const children = page.props.children as [
        ReactElement<{ dangerouslySetInnerHTML: { __html: string } }>,
        ReactElement<{ sourceRoute?: string }>,
      ];
      const script = children[0].props.dangerouslySetInnerHTML.__html;
      const structured = JSON.parse(script);
      expect(structured.name).toBe(guide.title[locale]);
      expect(structured.step.map((step: { text: string }) => step.text)).toEqual(
        guide.steps.map((step) => step.body[locale]),
      );
      expect(structured.step[0].url).toBe("https://www.bazaar.kg/help/inventory/receiving#step-1");
      expect((await generateMetadata({ params: Promise.resolve(params) })).title).toBe(
        `${guide.title[locale]} — Bazaar Guide`,
      );
      expect(children[1].props.sourceRoute).toBe("/inventory/receiving");
    },
  );
  it("preserves not-found handling rather than rendering an unrelated instruction", async () => {
    await expect(
      GuidePage({ params: Promise.resolve({ category: "inventory", guide: "missing-guide" }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("notFound");
  });
  it.each([false, true])(
    "serves the localized public landing while retaining the authenticated destination=%s",
    async (authenticated) => {
      state.token = authenticated ? { role: "ADMIN" } : null;
      if (authenticated) await expect(LegacyHome()).rejects.toThrow("redirect:/dashboard");
      else expect((await LegacyHome()).type).toBe(MarketingLanding);
    },
  );
  it("preserves repeated query values and a nested path when removing a legacy locale prefix", async () => {
    await expect(
      LegacyRoute({
        params: Promise.resolve({ locale: "en", slug: ["help", "inventory", "receiving"] }),
        searchParams: Promise.resolve({ from: "/inventory/receiving", tag: ["stock", "cost"], absent: undefined }),
      }),
    ).rejects.toThrow(
      "redirect:/help/inventory/receiving?from=%2Finventory%2Freceiving&tag=stock&tag=cost",
    );
  });
});
