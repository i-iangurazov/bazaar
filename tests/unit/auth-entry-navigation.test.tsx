// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";
import SignupPage from "@/app/signup/page";
import InviteEntryPage from "@/app/invite/page";
import InvitePage from "@/app/invite/[token]/page";

const state = vi.hoisted(() => ({
  mode: "invite_only" as "open" | "invite_only",
  loading: false,
  error: null as Error | null,
  signup: vi.fn(),
  requestAccess: vi.fn(),
  acceptInvite: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push, replace: state.replace }),
  useParams: () => ({ token: "synthetic-invitation-token" }),
}));
vi.mock("@/components/auth-brand", () => ({ AuthBrand: () => <span>BAZAAR</span> }));
vi.mock("@/components/language-switcher", () => ({
  LanguageSwitcher: () => <span>Language</span>,
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    publicAuth: {
      signupMode: { useQuery: () => ({
        data: state.loading || state.error ? undefined : { mode: state.mode },
        isLoading: state.loading,
        error: state.error,
        refetch: state.refetch,
      }) },
      signup: { useMutation: () => ({ mutate: state.signup, isLoading: false }) },
      requestAccess: { useMutation: () => ({ mutate: state.requestAccess, isLoading: false }) },
      inviteDetails: { useQuery: () => ({
        data: state.loading || state.error ? undefined : {
          organizationName: "Synthetic organization",
          email: "invitee@example.invalid",
          role: "STAFF",
        },
        isLoading: state.loading,
        error: state.error,
        refetch: state.refetch,
      }) },
      acceptInvite: { useMutation: () => ({ mutate: state.acceptInvite, isLoading: false }) },
    },
  },
}));

const messages = { ru, kg, en };
type Locale = keyof typeof messages;

const show = (page: React.ReactNode, locale: Locale = "ru") => render(
  <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Asia/Bishkek">
    {page}
  </NextIntlClientProvider>,
);

const expectLoginNavigation = (label: string) => {
  const link = screen.getByRole("link", { name: label });
  expect(link.getAttribute("href")).toBe("/login");
  expect(link.getAttribute("target")).toBeNull();
  expect(link.closest("form")).toBeNull();
  link.focus();
  expect(document.activeElement).toBe(link);
};

beforeEach(() => {
  vi.clearAllMocks();
  state.mode = "invite_only";
  state.loading = false;
  state.error = null;
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.nativeRuntime;
});

describe.each(["web", "native-document"] as const)("auth return navigation (%s)", (surface) => {
  beforeEach(() => {
    // Exercise the real rendered anchors with the native document marker too;
    // returning to login must not depend on WKWebView's back history/gesture.
    if (surface === "native-document") document.documentElement.dataset.nativeRuntime = "capacitor";
  });

  it.each(["ru", "kg", "en"] as const)("keeps a visible, keyboard-accessible login route in %s", (locale) => {
    const copy = messages[locale];
    show(<SignupPage />, locale);
    expectLoginNavigation(copy.signup.backToLogin);
    expect(screen.queryByLabelText(copy.signup.password)).toBeNull();
    cleanup();

    state.mode = "open";
    show(<SignupPage />, locale);
    expectLoginNavigation(copy.signup.backToLogin);
    expect(screen.getByLabelText(copy.signup.password)).toBeTruthy();
    cleanup();

    show(<InviteEntryPage />, locale);
    fireEvent.click(screen.getByRole("button", { name: copy.invite.entrySubmit }));
    expect(screen.getByText(copy.invite.entryInvalid)).toBeTruthy();
    expectLoginNavigation(copy.invite.goToLogin);
    cleanup();

    show(<InvitePage />, locale);
    expectLoginNavigation(copy.invite.goToLogin);
    expect(screen.getByLabelText(copy.invite.password)).toBeTruthy();
    expect(state.signup).not.toHaveBeenCalled();
    expect(state.requestAccess).not.toHaveBeenCalled();
    expect(state.acceptInvite).not.toHaveBeenCalled();
    expect(state.push).not.toHaveBeenCalled();
    expect(state.replace).not.toHaveBeenCalled();
  });

  it.each(["loading", "error"] as const)("allows leaving %s signup and invitation lookup", (phase) => {
    state.loading = phase === "loading";
    state.error = phase === "error" ? new Error("synthetic unavailable service") : null;
    show(<SignupPage />);
    expectLoginNavigation(ru.signup.backToLogin);
    expect(screen.queryByRole("button", { name: ru.signup.createAccount })).toBeNull();
    cleanup();

    show(<InvitePage />);
    expectLoginNavigation(ru.invite.goToLogin);
    expect(screen.queryByRole("button", { name: ru.invite.accept })).toBeNull();
    expect(state.acceptInvite).not.toHaveBeenCalled();
    expect(state.refetch).not.toHaveBeenCalled();
  });
});
