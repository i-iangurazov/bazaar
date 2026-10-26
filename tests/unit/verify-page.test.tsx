// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  token: "synthetic-verification-token",
  push: vi.fn(), mutate: vi.fn(),
  success: null as null | ((result: { nextPath: string }) => void),
  error: null as null | ((error: { message: string; data: { code: string } }) => void),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ token: state.token }), useRouter: () => ({ push: state.push }) }));
vi.mock("next-intl", () => ({ useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}` }));
vi.mock("@/components/auth-brand", () => ({ AuthBrand: () => <span>BAZAAR</span> }));
vi.mock("@/components/language-switcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/lib/trpc", () => ({ trpc: { publicAuth: { verifyEmail: { useMutation: (callbacks: { onSuccess: typeof state.success; onError: typeof state.error }) => {
  state.success = callbacks.onSuccess; state.error = callbacks.onError;
  return { mutate: state.mutate };
} } } } }));
import VerifyPage from "@/app/verify/[token]/page";

afterEach(() => { cleanup(); vi.clearAllMocks(); state.token = "synthetic-verification-token"; });
describe("verification result presentation", () => {
  it("does not reuse a previous success or onboarding destination when the token changes", () => {
    const view = render(<VerifyPage />);
    act(() => state.success?.({ nextPath: "/register-business/synthetic" }));
    state.token = "another-synthetic-token";
    view.rerender(<VerifyPage />);
    expect(screen.queryByText("verify.success")).toBeNull();
    expect(screen.getByText("common.loading")).toBeTruthy();
    expect(state.mutate).toHaveBeenLastCalledWith({ token: state.token });
    act(() => state.error?.({ message: "tokenInvalid", data: { code: "NOT_FOUND" } }));
    expect(screen.getByRole("button", { name: "verify.goToLogin" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "verify.goToRegisterBusiness" })).toBeNull();
  });
  it("shows an expired or reused token as an error instead of claiming the email is verified", () => {
    render(<VerifyPage />);
    expect(state.mutate).toHaveBeenCalledOnce();
    expect(state.mutate).toHaveBeenCalledWith({ token: "synthetic-verification-token" });
    act(() => state.error?.({ message: "tokenExpired", data: { code: "CONFLICT" } }));
    expect(screen.queryByText("verify.success")).toBeNull();
    expect(screen.getByText("errors.tokenInvalid")).toBeTruthy();
  });
  it("preserves the next onboarding step after actual verification succeeds", () => {
    render(<VerifyPage />);
    act(() => state.success?.({ nextPath: "/register-business/synthetic" }));
    expect(screen.getByText("verify.success")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "verify.goToRegisterBusiness" }));
    expect(state.push).toHaveBeenCalledWith("/register-business/synthetic");
  });
  it("offers retry for a service failure without calling the link invalid or claiming success", () => {
    render(<VerifyPage />);
    act(() => state.error?.({ message: "Synthetic unavailable service", data: { code: "INTERNAL_SERVER_ERROR" } }));
    expect(screen.queryByText("errors.tokenInvalid")).toBeNull();
    expect(screen.queryByText("verify.success")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "common.tryAgain" }));
    expect(state.mutate).toHaveBeenCalledTimes(2);
    expect(state.mutate).toHaveBeenLastCalledWith({ token: "synthetic-verification-token" });
    expect(screen.getByText("common.loading")).toBeTruthy();
    act(() => state.success?.({ nextPath: "/login" }));
    expect(screen.getByText("verify.success")).toBeTruthy();
  });
});
