// @vitest-environment jsdom
import React from "react";
import { renderToString } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ register: vi.fn(), locale: "ru", localizeErrors: false }));
vi.mock("next/navigation", () => ({ useParams: () => ({ token: "synthetic-registration-token" }) }));
vi.mock("next-intl", () => ({
  useLocale: () => state.locale,
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}${state.localizeErrors && key.endsWith("Required") ? `:${state.locale}` : ""}`,
}));
vi.mock("@/components/auth-brand", () => ({ AuthBrand: () => <span>BAZAAR</span> }));
vi.mock("@/components/language-switcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { publicAuth: {
  registerBusiness: { useMutation: () => ({ mutate: state.register, isLoading: false }) },
} } }));
import RegisterBusinessPage from "@/app/register-business/[token]/page";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => { state.locale = "ru"; state.localizeErrors = false; });
describe("business registration form presentation", () => {
  it("retranslates validation without losing the business details", () => {
    state.localizeErrors = true;
    const page = render(<RegisterBusinessPage />);
    fireEvent.change(screen.getByLabelText("registerBusiness.orgName"), { target: { value: "Synthetic org" } });
    fireEvent.change(screen.getByLabelText("registerBusiness.storeName"), { target: { value: "Synthetic store" } });
    fireEvent.click(screen.getByRole("button", { name: "registerBusiness.submit" }));
    expect(screen.getByText("registerBusiness.storeCodeRequired:ru")).toBeTruthy();
    state.locale = "en";
    page.rerender(<RegisterBusinessPage />);
    expect(screen.getByText("registerBusiness.storeCodeRequired:en")).toBeTruthy();
    expect((screen.getByLabelText("registerBusiness.orgName") as HTMLInputElement).value).toBe("Synthetic org");
    expect(state.register).not.toHaveBeenCalled();
  });
  it("uses POST and blocks submission before hydration", () => {
    const doc = new DOMParser().parseFromString(renderToString(<RegisterBusinessPage />), "text/html");
    expect(doc.querySelector("form")?.method).toBe("post");
    expect(doc.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });
  it("names the legal-form control and validates required fields before any business is created", () => {
    render(<RegisterBusinessPage />);
    expect(screen.getByRole("combobox", { name: "registerBusiness.legalEntityType" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "registerBusiness.submit" }));
    for (const field of ["orgRequired", "storeRequired", "storeCodeRequired"]) {
      expect(screen.getByText(`registerBusiness.${field}`)).toBeTruthy();
    }
    expect(state.register).not.toHaveBeenCalled();
  });
});
