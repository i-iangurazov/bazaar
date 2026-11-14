// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";

const controls = vi.hoisted(() => ({
  query: { data: { version: "2026-11-11", granted: false }, isLoading: false, error: null as Error | null },
  mutation: { isLoading: false, error: null as Error | null },
  mutate: vi.fn(), refetch: vi.fn(), setData: vi.fn(), invalidate: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({ userSettings: { aiConsent: { setData: controls.setData }, getMyProfile: { invalidate: controls.invalidate } } }),
  userSettings: { aiConsent: { useQuery: () => ({ ...controls.query, refetch: controls.refetch }) },
    updateAiConsent: { useMutation: () => ({ ...controls.mutation, mutate: controls.mutate }) } },
} }));
import { AiPrivacyConsent } from "@/components/ai-privacy-consent";

const view = (showStatus = false) => <NextIntlClientProvider locale="en" messages={messages}>
  <AiPrivacyConsent showStatus={showStatus}><button type="button">Send private question</button></AiPrivacyConsent>
</NextIntlClientProvider>;

describe("AI privacy choices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controls.query.data = { version: "2026-11-11", granted: false };
    controls.query.isLoading = false; controls.query.error = null;
    controls.mutation.isLoading = false; controls.mutation.error = null;
  });
  afterEach(cleanup);

  it("discloses processors and requires a separate explicit action before enabling private submission", () => {
    const ui = render(view());
    expect(screen.queryByRole("button", { name: "Send private question" })).toBeNull();
    expect(screen.getByRole("link", { name: "OpenAI" }).getAttribute("href")).toBe("https://openai.com/policies/privacy-policy/");
    expect(screen.getByRole("link", { name: "DeepSeek" })).toBeTruthy();
    expect(controls.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Allow sharing with AI services" }));
    expect(controls.mutate).toHaveBeenCalledWith({ granted: true, version: "2026-11-11" });
    // No optimistic permission: the authenticated server response is authoritative.
    expect(screen.queryByRole("button", { name: "Send private question" })).toBeNull();
    controls.query.data = { ...controls.query.data, granted: true };
    ui.rerender(view());
    expect(screen.getByRole("button", { name: "Send private question" })).toBeTruthy();
  });

  it("allows refusal and withdrawal, and a failed change does not silently grant permission", () => {
    const ui = render(view());
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(controls.mutate).toHaveBeenLastCalledWith({ granted: false, version: "2026-11-11" });
    controls.mutation.error = new Error("accountConsentChanged");
    ui.rerender(view());
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send private question" })).toBeNull();
    controls.query.data = { ...controls.query.data, granted: true };
    controls.mutation.error = null;
    ui.rerender(view(true));
    fireEvent.click(screen.getByRole("button", { name: "Withdraw permission" }));
    expect(controls.mutate).toHaveBeenLastCalledWith({ granted: false, version: "2026-11-11" });
    controls.query.data = { ...controls.query.data, granted: false };
    ui.rerender(view());
    expect(screen.queryByRole("button", { name: "Send private question" })).toBeNull();
    expect(screen.getByRole("button", { name: "Allow sharing with AI services" })).toBeTruthy();
  });

  it("fails closed while loading or unavailable, with a recoverable retry", () => {
    controls.query.isLoading = true;
    const ui = render(view());
    expect(screen.queryByRole("button", { name: "Send private question" })).toBeNull();
    controls.query.isLoading = false;
    controls.query.error = new Error("serviceUnavailable");
    ui.rerender(view());
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(controls.refetch).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Allow sharing with AI services" })).toBeNull();
  });
});
