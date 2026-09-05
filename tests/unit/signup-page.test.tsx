// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SignupPage from "@/app/signup/page";

const mocks = vi.hoisted(() => ({
  modeQuery: {
    data: undefined as { mode: "open" | "invite_only" } | undefined,
    isLoading: true,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  signupMutate: vi.fn(),
  requestMutate: vi.fn(),
  requestSuccess: null as (() => void) | null,
  signupError: null as ((error: { message: string }) => void) | null,
  replace: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) =>
    Object.assign((key: string) => `${namespace}.${key}`, { has: () => true }),
}));
vi.mock("@/components/auth-brand", () => ({ AuthBrand: () => <span>BAZAAR</span> }));
vi.mock("@/components/language-switcher", () => ({
  LanguageSwitcher: () => <span>Interface language</span>,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    publicAuth: {
      signupMode: { useQuery: () => mocks.modeQuery },
      requestAccess: {
        useMutation: (options: { onSuccess: () => void }) => {
          mocks.requestSuccess = options.onSuccess;
          return { mutate: mocks.requestMutate, isLoading: false };
        },
      },
      signup: {
        useMutation: (options: { onError: (error: { message: string }) => void }) => {
          mocks.signupError = options.onError;
          return { mutate: mocks.signupMutate, isLoading: false };
        },
      },
    },
  },
}));

describe("signup mode transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.modeQuery.data = undefined;
    mocks.modeQuery.isLoading = true;
    mocks.modeQuery.error = null;
    // Radix scrolls the selected option into view when the list opens.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(cleanup);

  it("loads the open form with a named language selector and preserves entered values on failure", () => {
    const page = render(<SignupPage />);
    expect(screen.getByRole("status").textContent).toContain("common.loading");
    expect(screen.queryByRole("combobox")).toBeNull();

    mocks.modeQuery.isLoading = false;
    mocks.modeQuery.data = { mode: "open" };
    page.rerender(<SignupPage />);

    expect(screen.queryByRole("status")).toBeNull();
    const language = screen.getByRole("combobox", { name: "signup.preferredLocale" });
    fireEvent.keyDown(language, { key: "ArrowDown" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "common.locales.ru",
      "common.locales.kg",
      "common.locales.en",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "common.locales.kg" }));
    fireEvent.change(screen.getByLabelText("signup.name"), { target: { value: "Synthetic User" } });
    fireEvent.change(screen.getByLabelText("signup.email"), {
      target: { value: "signup@example.com" },
    });
    fireEvent.change(screen.getByLabelText("signup.password"), {
      target: { value: "synthetic-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "signup.createAccount" }));

    expect(mocks.signupMutate).toHaveBeenCalledWith({
      name: "Synthetic User",
      email: "signup@example.com",
      password: "synthetic-password",
      preferredLocale: "kg",
    });
    expect(mocks.requestMutate).not.toHaveBeenCalled();
    act(() => mocks.signupError?.({ message: "signupInviteOnly" }));
    expect(screen.getByText("errors.signupInviteOnly")).toBeTruthy();
    expect((screen.getByLabelText("signup.name") as HTMLInputElement).value).toBe("Synthetic User");
    expect((screen.getByLabelText("signup.email") as HTMLInputElement).value).toBe(
      "signup@example.com",
    );
    expect(language.textContent).toContain("common.locales.kg");
  });

  it("loads only the invitation request form and retains its success semantics", () => {
    const page = render(<SignupPage />);
    mocks.modeQuery.isLoading = false;
    mocks.modeQuery.data = { mode: "invite_only" };
    page.rerender(<SignupPage />);

    expect(screen.queryByLabelText("signup.password")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.change(screen.getByLabelText("signup.email"), {
      target: { value: "request@example.com" },
    });
    fireEvent.change(screen.getByLabelText("signup.orgName"), {
      target: { value: "Synthetic Business" },
    });
    fireEvent.click(screen.getByRole("button", { name: "signup.requestAccess" }));

    expect(mocks.requestMutate).toHaveBeenCalledWith({
      email: "request@example.com",
      orgName: "Synthetic Business",
    });
    expect(mocks.signupMutate).not.toHaveBeenCalled();
    act(() => mocks.requestSuccess?.());
    expect(screen.getByText("signup.submittedRequest")).toBeTruthy();
    expect(screen.getByRole("link", { name: "signup.backToLogin" }).getAttribute("href")).toBe(
      "/login",
    );
  });

  it("shows a recoverable mode lookup error without assuming open registration", () => {
    const page = render(<SignupPage />);
    mocks.modeQuery.isLoading = false;
    mocks.modeQuery.error = new Error("synthetic network failure");
    page.rerender(<SignupPage />);

    expect(screen.getByRole("alert").textContent).toContain("errors.genericMessage");
    expect(screen.queryByRole("button", { name: "signup.createAccount" })).toBeNull();
    expect(screen.queryByRole("button", { name: "signup.requestAccess" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "common.tryAgain" }));
    expect(mocks.modeQuery.refetch).toHaveBeenCalledOnce();
    expect(mocks.signupMutate).not.toHaveBeenCalled();
    expect(mocks.requestMutate).not.toHaveBeenCalled();
  });
});
