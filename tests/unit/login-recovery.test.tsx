// @vitest-environment jsdom
import React from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  signIn: vi.fn(), resend: vi.fn(), replace: vi.fn(),
  next: null as string | null,
  success: null as null | (() => void),
  failure: null as null | ((error: { message: string }) => void),
}));
vi.mock("next-auth/react", () => ({ signIn: state.signIn, getSession: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace }),
  useSearchParams: () => new URLSearchParams(state.next ? { next: state.next } : {}),
}));
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => Object.assign((key: string) => `${namespace}.${key}`, { has: () => true }),
}));
vi.mock("@/lib/trpc", () => ({ trpc: { publicAuth: { resendVerification: {
  useMutation: (callbacks: { onSuccess: typeof state.success; onError: typeof state.failure }) => {
    state.success = callbacks.onSuccess; state.failure = callbacks.onError;
    return { mutate: state.resend, isLoading: false };
  },
} } } }));
import { LoginForm } from "@/components/login-form";

afterEach(() => { cleanup(); vi.clearAllMocks(); state.next = null; });
describe("login verification recovery", () => {
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
