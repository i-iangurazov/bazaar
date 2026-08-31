// @vitest-environment jsdom

import React, { type PropsWithChildren } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  catalogContrastRatio,
  resolveCatalogAccentForeground,
} from "@/components/catalog/catalog-accessibility";
import { PublicCatalogPage } from "@/components/catalog/public-catalog-page";
import type { PublicCatalogPayload } from "@/server/services/bazaarCatalog";

beforeAll(() => {
  vi.stubGlobal("React", React);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

vi.mock("next-intl", () => {
  const translate = (key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${Object.values(values).join(":")}` : key;
  translate.has = () => true;
  return {
    useLocale: () => "en",
    useTranslations: () => translate,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: PropsWithChildren<{ href: string }>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/language-switcher", () => ({
  LanguageSwitcher: () => null,
}));

vi.mock("@/components/ui/modal", () => ({
  Modal: ({ open, title, children }: PropsWithChildren<{ open: boolean; title: string }>) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
}));

vi.mock("@/components/phone-number-input", () => ({
  PhoneNumberInput: ({
    inputId,
    value,
    onChange,
    inputAriaInvalid,
    inputAriaDescribedBy,
  }: {
    inputId?: string;
    value: string;
    onChange: (value: string) => void;
    inputAriaInvalid?: boolean;
    inputAriaDescribedBy?: string;
  }) => (
    <input
      id={inputId}
      value={value}
      aria-invalid={inputAriaInvalid}
      aria-describedby={inputAriaDescribedBy}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const catalogFixture = (accentColor = "#ffffff"): PublicCatalogPayload => ({
  slug: "catalog-accessibility",
  storeId: "store-1",
  title: "Accessible catalogue",
  storeName: "Test store",
  currencyCode: "KGS",
  accentColor,
  fontFamily: "System",
  headerStyle: "STANDARD",
  logoUrl: null,
  categories: [{ key: "clothing", name: "Clothing", count: 1 }],
  pagination: {
    page: 1,
    pageSize: 24,
    total: 1,
    totalPages: 1,
    hasMore: false,
  },
  products: [
    {
      id: "product-1",
      name: "T-shirt",
      category: "Clothing",
      priceKgs: 500,
      quotedUnitPriceKgs: 500,
      compareAtPriceKgs: null,
      hasDiscount: false,
      discountPercentage: null,
      imageUrl: null,
      isBundle: false,
      variants: [],
    },
  ],
});

const renderCatalog = (accentColor?: string) =>
  render(
    <PublicCatalogPage slug="catalog-accessibility" initialCatalog={catalogFixture(accentColor)} />,
  );

const buttonContaining = (text: string) => {
  const match = screen.getAllByRole("button").find((button) => button.textContent?.includes(text));
  expect(match, `button containing ${text}`).toBeTruthy();
  return match!;
};

describe("public catalog accessibility", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("announces checkout errors and associates each invalid field with the alert", async () => {
    renderCatalog();
    fireEvent.click(screen.getByRole("button", { name: "qtyIncrease:T-shirt" }));
    fireEvent.click(buttonContaining("cartButton"));
    fireEvent.click(screen.getByRole("button", { name: "checkoutOpen" }));
    fireEvent.click(screen.getByRole("button", { name: "checkoutSubmit" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("checkoutRequired");
    expect(alert.id).not.toBe("");

    for (const control of [
      screen.getByLabelText("checkoutName"),
      screen.getByLabelText("checkoutEmail"),
      screen.getByLabelText("checkoutPhone"),
    ]) {
      expect(control.getAttribute("aria-invalid")).toBe("true");
      expect(control.getAttribute("aria-describedby")).toBe(alert.id);
      expect(document.getElementById(control.getAttribute("aria-describedby") ?? "")).toBe(alert);
    }
  });

  it("forwards checkout ARIA state to the focusable phone input", async () => {
    const { PhoneNumberInput } = await vi.importActual<{
      PhoneNumberInput: React.ComponentType<{
        value: string;
        onChange: (value: string) => void;
        inputId: string;
        countrySelectLabel: string;
        inputAriaInvalid: boolean;
        inputAriaDescribedBy: string;
      }>;
    }>("@/components/phone-number-input");

    render(
      <PhoneNumberInput
        value=""
        onChange={() => undefined}
        inputId="checkout-phone-forwarding"
        countrySelectLabel="Country"
        inputAriaInvalid
        inputAriaDescribedBy="checkout-phone-error"
      />,
    );

    const input = document.getElementById("checkout-phone-forwarding");
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(input?.getAttribute("aria-describedby")).toBe("checkout-phone-error");
  });

  it.each(["#ffffff", "#facc15", "#94a3b8"])(
    "chooses an AA-safe foreground for accent %s",
    (accentColor) => {
      const foreground = resolveCatalogAccentForeground(accentColor);
      expect(catalogContrastRatio(accentColor, foreground)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("applies the selected foreground to accent-backed catalog actions", () => {
    renderCatalog("#ffffff");

    const action = screen.getByRole("button", { name: "qtyIncrease:T-shirt" });
    expect(action.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(action.style.color).toBe("rgb(0, 0, 0)");
  });

  it("exposes stable expanded state and a persistent controlled category region", () => {
    renderCatalog();
    const disclosure = screen.getByRole("button", { name: /Clothing/ });
    const regionId = disclosure.getAttribute("aria-controls");

    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(regionId).toBeTruthy();
    expect(document.getElementById(regionId ?? "")).toBeTruthy();

    fireEvent.click(disclosure);

    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(regionId ?? "")?.hidden).toBe(true);
  });

  it("gives the powered-by link one non-duplicated accessible name", () => {
    renderCatalog();

    const poweredBy = screen.getByRole("link", { name: "poweredBy" });
    expect(poweredBy.querySelector("img")?.getAttribute("alt")).toBe("");
  });
});
