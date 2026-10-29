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
import GuidePage, { generateMetadata } from "@/app/(guide)/help/[category]/[guide]/page";
import LegacyHome from "@/app/[locale]/page";
import LegacyRoute from "@/app/[locale]/[...slug]/page";
import { getHelpGuide } from "@/content/help/catalog";

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
      const page = await GuidePage({ params, searchParams: { from: "/inventory/receiving" } });
      const children = page.props.children as ReactElement[];
      const script = children[0].props.dangerouslySetInnerHTML.__html;
      const structured = JSON.parse(script);
      expect(structured.name).toBe(guide.title[locale]);
      expect(structured.step.map((step: { text: string }) => step.text)).toEqual(
        guide.steps.map((step) => step.body[locale]),
      );
      expect(structured.step[0].url).toBe("https://www.bazaar.kg/help/inventory/receiving#step-1");
      expect((await generateMetadata({ params })).title).toBe(
        `${guide.title[locale]} — Bazaar Guide`,
      );
      expect(children[1].props.sourceRoute).toBe("/inventory/receiving");
    },
  );
  it("preserves not-found handling rather than rendering an unrelated instruction", async () => {
    await expect(
      GuidePage({ params: { category: "inventory", guide: "missing-guide" }, searchParams: {} }),
    ).rejects.toThrow("notFound");
  });
  it.each([false, true])(
    "retains the legacy localized home destination with authenticated=%s",
    async (authenticated) => {
      state.token = authenticated ? { role: "ADMIN" } : null;
      await expect(LegacyHome()).rejects.toThrow(
        `redirect:${authenticated ? "/dashboard" : "/login"}`,
      );
    },
  );
  it("preserves repeated query values and a nested path when removing a legacy locale prefix", () => {
    expect(() =>
      LegacyRoute({
        params: { locale: "en", slug: ["help", "inventory", "receiving"] },
        searchParams: { from: "/inventory/receiving", tag: ["stock", "cost"], absent: undefined },
      }),
    ).toThrow(
      "redirect:/help/inventory/receiving?from=%2Finventory%2Freceiving&tag=stock&tag=cost",
    );
  });
});
