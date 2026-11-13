import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ cookie: "en", headers: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: state.cookie }) }),
  headers: async () => new Headers(state.headers),
}));
vi.mock("next-intl/server", () => ({ getRequestConfig: (config: unknown) => config }));

import requestConfig from "@/i18n";
import { marketingLocaleHeader } from "@/lib/marketingSeo";

afterEach(() => {
  state.cookie = "en";
  state.headers = {};
});

describe("server-rendered marketing language", () => {
  it.each(["ru", "kg", "en"])("uses the validated %s URL locale ahead of cookies and browser language", async (locale) => {
    state.cookie = locale === "ru" ? "en" : "ru";
    state.headers = { [marketingLocaleHeader]: locale, "accept-language": "en-US" };
    const config = await requestConfig({ requestLocale: Promise.resolve(undefined) });
    expect(config.locale).toBe(locale);
    expect(config.messages).toHaveProperty("billing.plans.starter.name", "Новичок");
  });

  it("retains the existing cookie language for the unprefixed application", async () => {
    state.cookie = "kg";
    state.headers = { "accept-language": "en-US" };
    expect((await requestConfig({ requestLocale: Promise.resolve(undefined) })).locale).toBe("kg");
  });

  it("ignores unsupported URL locale values and uses the existing preference", async () => {
    state.cookie = "ru";
    state.headers = { [marketingLocaleHeader]: "../../en", "accept-language": "en-US" };
    expect((await requestConfig({ requestLocale: Promise.resolve(undefined) })).locale).toBe("ru");
  });
});
