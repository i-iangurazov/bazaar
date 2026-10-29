// @vitest-environment jsdom
import React from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  locale: "ru",
  localizeValidation: false,
  signIn: vi.fn(), getSession: vi.fn(), resend: vi.fn(), replace: vi.fn(),
  next: null as string | null,
  success: null as null | (() => void),
  failure: null as null | ((error: { message: string }) => void),
}));
vi.mock("next-auth/react", () => ({ signIn: state.signIn, getSession: state.getSession }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace }),
  useSearchParams: () => new URLSearchParams(state.next ? { next: state.next } : {}),
}));
vi.mock("next-intl", () => ({
  useLocale: () => state.locale,
  useTranslations: (namespace: string) => Object.assign((key: string) =>
    `${namespace}.${key}${state.localizeValidation && ["emailRequired", "emailInvalid", "passwordRequired"].includes(key) ? `:${state.locale}` : ""}`,
  { has: () => true }),
}));
vi.mock("@/lib/trpc", () => ({ trpc: { publicAuth: { resendVerification: {
  useMutation: (callbacks: { onSuccess: typeof state.success; onError: typeof state.failure }) => {
    state.success = callbacks.onSuccess; state.failure = callbacks.onError;
    return { mutate: state.resend, isLoading: false };
  },
} } } }));
import { LoginForm } from "@/components/login-form";

afterEach(() => { cleanup(); vi.clearAllMocks(); state.next = null; });
beforeEach(() => {
  state.locale = "ru";
  state.localizeValidation = false;
  state.getSession.mockResolvedValue({ user: { role: "ADMIN", isPlatformOwner: false } });
});

const submitCredentials = () => {
  fireEvent.change(screen.getByLabelText("auth.email"), { target: { value: "synthetic@example.invalid" } });
  fireEvent.change(screen.getByLabelText("auth.password"), { target: { value: "Synthetic-Password!" } });
  fireEvent.click(screen.getByRole("button", { name: "auth.signIn" }));
};

describe("login verification recovery", () => {
  it("translates existing field errors when the interface locale changes without clearing input", async () => {
    state.localizeValidation = true;
    const view = render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("auth.email"), { target: { value: "synthetic@example.invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "auth.signIn" }));
    await screen.findByText("auth.passwordRequired:ru");
    state.locale = "kg";
    view.rerender(<LoginForm />);
    await screen.findByText("auth.passwordRequired:kg");
    expect(screen.queryByText("auth.passwordRequired:ru")).toBeNull();
    expect((screen.getByLabelText("auth.email") as HTMLInputElement).value).toBe("synthetic@example.invalid");
    expect(state.signIn).not.toHaveBeenCalled();
  });
  it.each([
    ["loginRateLimited", "loginRateLimited"], ["loginLocked", "loginLocked"],
    ["loginBackoff", "loginBackoff"], ["registrationNotCompleted", "registrationNotCompleted"],
    ["CredentialsSignin", "invalidCredentials"],
  ])("preserves the server rejection message for %s", async (error, message) => {
    state.signIn.mockResolvedValue({ ok: false, error });
    render(<LoginForm />);
    submitCredentials();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(`auth.${message}`));
    expect(state.getSession).not.toHaveBeenCalled();
    expect(state.replace).not.toHaveBeenCalled();
  });
  it.each([
    ["ADMIN", "/dashboard"], ["MANAGER", "/dashboard"],
    ["STAFF", "/pos"], ["CASHIER", "/pos"],
  ])("opens the existing home route for %s", async (role, destination) => {
    state.signIn.mockResolvedValue({ ok: true, error: null });
    state.getSession.mockResolvedValue({ user: { role, isPlatformOwner: false } });
    render(<LoginForm />);
    submitCredentials();
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith(destination));
  });

  it("preserves the platform owner's default workspace", async () => {
    state.signIn.mockResolvedValue({ ok: true, error: null });
    state.getSession.mockResolvedValue({ user: { role: "ADMIN", isPlatformOwner: true } });
    render(<LoginForm />);
    submitCredentials();
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith("/platform"));
  });

  it.each([
    ["/products?page=2&storeId=synthetic#details", "/products?page=2&storeId=synthetic#details"],
    ["/kg/pos?storeId=synthetic", "/pos?storeId=synthetic"],
    ["/en/inventory/receiving", "/inventory/receiving"],
  ])("preserves an explicit safe internal destination: %s", async (next, destination) => {
    state.next = next;
    state.signIn.mockResolvedValue({ ok: true, error: null });
    render(<LoginForm />);
    submitCredentials();
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith(destination));
  });

  it.each(["login", "session", "missing-session"])("allows retry after a %s transport failure without clearing credentials", async (boundary) => {
    state.signIn.mockResolvedValue({ ok: true, error: null });
    if (boundary === "login") state.signIn.mockRejectedValueOnce(new Error("Synthetic network failure"));
    if (boundary === "session") state.getSession.mockRejectedValueOnce(new Error("Synthetic session lookup failure"));
    if (boundary === "missing-session") state.getSession.mockResolvedValueOnce(null);
    render(<LoginForm />);
    submitCredentials();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("auth.loginUnavailable"));
    expect(state.replace).not.toHaveBeenCalled();
    expect((screen.getByLabelText("auth.email") as HTMLInputElement).value).toBe("synthetic@example.invalid");
    expect((screen.getByRole("button", { name: "auth.signIn" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "auth.signIn" }));
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith("/dashboard"));
    expect(state.signIn).toHaveBeenCalledTimes(2);
  });

  it.each(["//untrusted.invalid", "/\\untrusted.invalid", "/ru//untrusted.invalid"])(
    "keeps a successful login on Bazaar when next contains an external destination: %s", async (next) => {
      state.next = next;
      state.signIn.mockResolvedValue({ ok: true, error: null });
      render(<LoginForm />);
      fireEvent.change(screen.getByLabelText("auth.email"), { target: { value: "synthetic@example.invalid" } });
      fireEvent.change(screen.getByLabelText("auth.password"), { target: { value: "Synthetic-Password!" } });
      fireEvent.click(screen.getByRole("button", { name: "auth.signIn" }));
      await waitFor(() => expect(state.replace).toHaveBeenCalledWith("/dashboard"));
    },
  );
  it("server HTML disables submission until hydration and never defaults password submission to GET", () => {
    const doc = new DOMParser().parseFromString(renderToString(<LoginForm />), "text/html");
    expect(doc.querySelector("form")?.method).toBe("post");
    expect(doc.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });

  it("lets an unverified user retry email delivery without granting a session or navigating", async () => {
    state.signIn.mockResolvedValue({ error: "emailNotVerified" });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("auth.email"), { target: { value: "synthetic@example.invalid" } });
    fireEvent.change(screen.getByLabelText("auth.password"), { target: { value: "Synthetic-Password!" } });
    fireEvent.click(screen.getByRole("button", { name: "auth.signIn" }));
    const resend = await screen.findByRole("button", { name: "nav.emailVerificationResend" });
    fireEvent.click(resend);
    await waitFor(() => expect(state.resend).toHaveBeenCalledWith({ email: "synthetic@example.invalid" }));
    act(() => state.failure?.({ message: "emailDeliveryFailed" }));
    expect(screen.getByText("errors.emailDeliveryFailed")).toBeTruthy();
    expect((resend as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(resend);
    await waitFor(() => expect(state.resend).toHaveBeenCalledTimes(2));
    act(() => state.success?.());
    expect((screen.getByRole("button", { name: "nav.emailVerificationSent" }) as HTMLButtonElement).disabled).toBe(true);
    expect(state.replace).not.toHaveBeenCalled();
  });
});
