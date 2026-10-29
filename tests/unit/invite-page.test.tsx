// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  locale: "ru",
  localizeErrors: false,
  error: null as null | { message: string; data: { code: string } },
  data: null as null | { organizationName: string; email: string; role: string },
  refetch: vi.fn(),
  accept: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ token: "synthetic-invite-token" }), useRouter: () => ({ push: state.push }) }));
vi.mock("next-intl", () => ({
  useLocale: () => state.locale,
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}${state.localizeErrors && ["nameRequired", "passwordMin", "entryInvalid"].includes(key) ? `:${state.locale}` : ""}`,
}));
vi.mock("@/components/auth-brand", () => ({ AuthBrand: () => <span>BAZAAR</span> }));
vi.mock("@/components/language-switcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { publicAuth: {
  inviteDetails: { useQuery: () => ({ error: state.error, data: state.data, isLoading: false, refetch: state.refetch }) },
  acceptInvite: { useMutation: () => ({ mutate: state.accept, isLoading: false }) },
} } }));
import InvitePage from "@/app/invite/[token]/page";
import InviteEntryPage from "@/app/invite/page";

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); state.error = null; state.data = null; state.locale = "ru"; state.localizeErrors = false; });
describe("invitation details and recovery", () => {
  it("translates an entry error and opens a pasted invitation without its external host or query", () => {
    state.localizeErrors = true;
    const page = render(<InviteEntryPage />);
    fireEvent.click(screen.getByRole("button", { name: "invite.entrySubmit" }));
    expect(screen.getByText("invite.entryInvalid:ru")).toBeTruthy();
    state.locale = "kg";
    page.rerender(<InviteEntryPage />);
    expect(screen.getByText("invite.entryInvalid:kg")).toBeTruthy();
    expect(state.push).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("invite.entryLabel"), {
      target: { value: "https://example.invalid/invite/synthetic-invite-token?tracking=ignored#code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "invite.entrySubmit" }));
    expect(state.push).toHaveBeenCalledWith("/invite/synthetic-invite-token");
  });
  it("retranslates validation while keeping the invitee's entered name", () => {
    state.localizeErrors = true;
    state.data = { organizationName: "Synthetic org", email: "synthetic@example.invalid", role: "STAFF" };
    const page = render(<InvitePage />);
    fireEvent.change(screen.getByLabelText("invite.name"), { target: { value: "Synthetic Name" } });
    fireEvent.click(screen.getByRole("button", { name: "invite.accept" }));
    expect(screen.getByText("invite.passwordMin:ru")).toBeTruthy();
    state.locale = "kg";
    page.rerender(<InvitePage />);
    expect(screen.getByText("invite.passwordMin:kg")).toBeTruthy();
    expect((screen.getByLabelText("invite.name") as HTMLInputElement).value).toBe("Synthetic Name");
    expect(state.accept).not.toHaveBeenCalled();
  });
  it("offers another invitation for an invalid link without exposing a credential form", () => {
    state.error = { message: "inviteInvalid", data: { code: "NOT_FOUND" } };
    render(<InvitePage />);
    expect(screen.getByRole("alert").textContent).toContain("invite.invalidInvite");
    expect(screen.getByRole("link", { name: "invite.tryAnotherInvite" }).getAttribute("href")).toBe("/invite");
    expect(screen.queryByLabelText("invite.password")).toBeNull();
    expect(state.accept).not.toHaveBeenCalled();
  });
  it("retries a service failure instead of claiming the invitation is expired", () => {
    state.error = { message: "Synthetic service failure", data: { code: "INTERNAL_SERVER_ERROR" } };
    render(<InvitePage />);
    expect(screen.queryByText("invite.invalidInvite")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "common.tryAgain" }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
    expect(state.accept).not.toHaveBeenCalled();
  });
  it("names the locale control and validates an empty form without accepting the invitation", () => {
    state.data = { organizationName: "Synthetic org", email: "synthetic@example.invalid", role: "STAFF" };
    render(<InvitePage />);
    expect(screen.getByRole("combobox", { name: "invite.preferredLocale" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "invite.accept" }));
    expect(screen.getByText("invite.nameRequired")).toBeTruthy();
    expect(screen.getByText("invite.passwordMin")).toBeTruthy();
    expect(state.accept).not.toHaveBeenCalled();
  });
});
