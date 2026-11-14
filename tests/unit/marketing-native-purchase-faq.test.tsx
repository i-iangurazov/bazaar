// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ platform: "ios" as "ios" | "web" | "android", detect: vi.fn() }));
vi.mock("@/lib/native/platform", () => ({ getNativePlatform: () => { native.detect(); return native.platform; } }));

import { getMarketingCopy } from "@/content/marketing";
import { MarketingPurchaseFaqAnswer } from "@/components/marketing/MarketingPurchaseFaqAnswer";

const answers = (locale: "ru" | "kg" | "en") => {
  const entries = getMarketingCopy(locale).faq.items.filter((item) => item.iosAnswer && item.pendingAnswer);
  expect(entries).toHaveLength(1);
  const item = entries[0];
  if (!item?.iosAnswer || !item.pendingAnswer) throw new Error("Missing localized purchase FAQ");
  return { answer: item.answer, iosAnswer: item.iosAnswer, pendingAnswer: item.pendingAnswer };
};

beforeEach(() => { vi.clearAllMocks(); native.platform = "ios"; });
afterEach(cleanup);

describe("native-reachable marketing purchase FAQ", () => {
  it.each(["ru", "kg", "en"] as const)("uses neutral %s copy before platform hydration, including server rendering", (locale) => {
    const copy = answers(locale);
    const container = document.createElement("div");
    container.innerHTML = renderToString(<MarketingPurchaseFaqAnswer {...copy} />);
    expect(container.textContent).toBe(copy.pendingAnswer);
    expect(container.textContent).not.toContain(copy.answer);
    expect(native.detect).not.toHaveBeenCalled();
  });

  it.each(["ru", "kg", "en"] as const)("shows the in-app StoreKit direction and existing-paid-access explanation in %s", (locale) => {
    const copy = answers(locale);
    const { container } = render(<MarketingPurchaseFaqAnswer {...copy} />);
    expect(container.textContent).toBe(copy.iosAnswer);
    expect(container.textContent).toContain("App Store");
    expect(container.textContent).toContain("Apple");
    expect(container.textContent).not.toContain(copy.answer);
    expect(container.textContent).not.toContain(copy.pendingAnswer);
    expect(native.detect).toHaveBeenCalledOnce();
  });

  it.each(["ru", "kg", "en"] as const)("preserves the existing web answer verbatim in %s", (locale) => {
    native.platform = "web";
    const copy = answers(locale);
    const { container } = render(<MarketingPurchaseFaqAnswer {...copy} />);
    expect(container.textContent).toBe(copy.answer);
    expect(container.textContent).not.toContain(copy.iosAnswer);
  });

  it("hydrates the neutral server answer directly into iOS purchase guidance", () => {
    const copy = answers("en");
    const container = document.createElement("div");
    container.innerHTML = renderToString(<MarketingPurchaseFaqAnswer {...copy} />);
    expect(container.textContent).toBe(copy.pendingAnswer);
    render(<MarketingPurchaseFaqAnswer {...copy} />, { container, hydrate: true });
    expect(container.textContent).toBe(copy.iosAnswer);
    expect(container.textContent).not.toContain("Contact support to activate or renew");
  });
});
