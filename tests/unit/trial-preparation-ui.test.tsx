// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ru from "../../messages/ru.json";
import { TrialPreparation } from "@/components/billing/trial-preparation";
import { formatCurrencyKGS } from "@/lib/i18nFormat";
import type { translateError } from "@/lib/translateError";

type Preview = {
  modules: string[];
  counts: { stores: number; bundles: number; loyaltyPrograms: number; draftOrders: number; reservations: number };
  draftChanges: { orderId: string; number: string; beforeTotalKgs: string; afterTotalKgs: string }[];
  confirmationToken: string;
};
type ClientError = NonNullable<Parameters<typeof translateError>[1]>;
const state = vi.hoisted(() => ({
  data: undefined as Preview | undefined,
  isLoading: false,
  isError: false,
  error: null as ClientError | null,
  preparing: false,
  refetch: vi.fn(),
  invalidate: vi.fn(),
  mutate: vi.fn(),
  onSuccess: null as (() => void) | null,
  onError: null as ((error: ClientError) => void) | null,
}));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({ invalidate: state.invalidate }),
  billing: { payments: {
    trialPreparation: { useQuery: () => ({ data: state.data, isLoading: state.isLoading, isError: state.isError,
      error: state.error, refetch: state.refetch }) },
    prepareTrial: { useMutation: (options: { onSuccess: () => void; onError: (error: ClientError) => void }) => {
      state.onSuccess = options.onSuccess; state.onError = options.onError;
      return { mutate: state.mutate, isLoading: state.preparing };
    } },
  } },
} }));
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (namespace: string) => {
    const sections: Record<string, Record<string, unknown>> = {
      "billing.trialPreparation": ru.billing.trialPreparation,
      "billing.plans": ru.billing.plans,
      common: ru.common,
      errors: ru.errors,
    };
    const copy = sections[namespace];
    if (!copy) throw new Error(`Unexpected translation namespace ${namespace}`);
    return Object.assign((key: string, params: Record<string, string | number> = {}) => {
      const text = key.split(".").reduce<unknown>((value, part) =>
        value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, copy);
      if (typeof text !== "string") throw new Error(`Missing string ${namespace}.${key}`);
      return Object.entries(params).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), text);
    }, { has: (key: string) => typeof copy[key] === "string" });
  },
}));
const fixture = (): Preview => ({
  modules: ["expiryLots", "bundles", "loyalty", "loyaltyReservations"],
  counts: { stores: 1, bundles: 2, loyaltyPrograms: 1, draftOrders: 1, reservations: 3 },
  draftChanges: [{ orderId: "draft-42", number: "TRIAL-42", beforeTotalKgs: "850.00", afterTotalKgs: "1000.00" }],
  confirmationToken: "server-issued-starter-impact-token",
});
const open = () => fireEvent.click(screen.getByRole("button", { name: ru.billing.trialPreparation.action }));
const confirmation = () => within(screen.getByRole("dialog"));
const confirmButton = () => confirmation().getByRole("button", { name: ru.billing.trialPreparation.action }) as HTMLButtonElement;
const failure = (message: string, code = "CONFLICT") => ({ message, data: { code } }) as ClientError;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { data: fixture(), isLoading: false, isError: false, error: null, preparing: false,
    onSuccess: null, onError: null });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("owner consent to prepare an expired trial for a lower subscription", () => {
  it("shows a loading state without offering an unverified preparation", () => {
    state.isLoading = true; state.data = undefined;
    render(<TrialPreparation plan="STARTER" onPrepared={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toBe(ru.common.loading);
    expect(screen.queryByRole("button", { name: ru.billing.trialPreparation.action })).toBeNull();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("lists affected configuration and exact draft amounts before explicit confirmation", () => {
    render(<TrialPreparation plan="STARTER" onPrepared={vi.fn()} />); open();
    const dialog = confirmation();
    expect(dialog.getByText(ru.billing.trialPreparation.stores.replace("{count}", "1"))).toBeTruthy();
    expect(dialog.getByText(ru.billing.trialPreparation.bundles.replace("{count}", "2"))).toBeTruthy();
    expect(dialog.getByText(ru.billing.trialPreparation.loyalty.replace("{count}", "1"))).toBeTruthy();
    expect(dialog.getByText(ru.billing.trialPreparation.drafts.replace("{count}", "1"))).toBeTruthy();
    expect(dialog.getByText(ru.billing.trialPreparation.reservations.replace("{count}", "3"))).toBeTruthy();
    expect(dialog.getByText(`TRIAL-42: ${formatCurrencyKGS(850, "ru")} → ${formatCurrencyKGS(1000, "ru")}`.replace(/\s+/g, " "))).toBeTruthy();
    expect(dialog.getByText(ru.billing.trialPreparation.draftWarning)).toBeTruthy();
    expect(dialog.getByText(ru.billing.trialPreparation.preserved)).toBeTruthy();
    expect(confirmButton().disabled).toBe(true);
    fireEvent.click(confirmButton());
    expect(state.mutate).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("checkbox"));
    expect(confirmButton().disabled).toBe(false);
    fireEvent.click(confirmButton());
    expect(state.mutate).toHaveBeenCalledOnce();
    expect(state.mutate).toHaveBeenCalledWith({ plan: "STARTER", confirmationToken: "server-issued-starter-impact-token", confirmed: true });
  });

  it("sends the frozen target plan and token when the parent selection changes while consent is open", () => {
    const onPrepared = vi.fn(); const view = render(<TrialPreparation plan="STARTER" onPrepared={onPrepared} />); open();
    state.data = { ...fixture(), confirmationToken: "new-business-impact-token", counts: { ...fixture().counts, bundles: 9 } };
    view.rerender(<TrialPreparation plan="BUSINESS" onPrepared={onPrepared} />);
    expect(confirmation().getByText(ru.billing.plans.starter.name)).toBeTruthy();
    expect(confirmation().queryByText(ru.billing.plans.business.name)).toBeNull();
    expect(confirmation().getByText(ru.billing.trialPreparation.bundles.replace("{count}", "2"))).toBeTruthy();
    fireEvent.click(confirmation().getByRole("checkbox")); fireEvent.click(confirmButton());
    expect(state.mutate).toHaveBeenCalledOnce();
    expect(state.mutate).toHaveBeenCalledWith({ plan: "STARTER", confirmationToken: "server-issued-starter-impact-token", confirmed: true });
  });

  it("cancels without mutation and resets consent before reopening", () => {
    render(<TrialPreparation plan="STARTER" onPrepared={vi.fn()} />); open();
    fireEvent.click(confirmation().getByRole("checkbox"));
    fireEvent.click(confirmation().getByRole("button", { name: ru.common.cancel }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(state.mutate).not.toHaveBeenCalled();
    open(); expect(confirmButton().disabled).toBe(true);
  });

  it("refreshes cached state and reports success only after confirmed preparation", () => {
    const onPrepared = vi.fn(); render(<TrialPreparation plan="STARTER" onPrepared={onPrepared} />); open();
    fireEvent.click(confirmation().getByRole("checkbox")); fireEvent.click(confirmButton());
    expect(onPrepared).not.toHaveBeenCalled();
    act(() => state.onSuccess?.());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(state.invalidate).toHaveBeenCalledOnce(); expect(onPrepared).toHaveBeenCalledOnce();
    open(); expect(confirmButton().disabled).toBe(true);
  });

  it("closes stale consent, explains a mutation failure and requests a fresh preview", () => {
    const onPrepared = vi.fn(); const view = render(<TrialPreparation plan="STARTER" onPrepared={onPrepared} />); open();
    fireEvent.click(confirmation().getByRole("checkbox")); fireEvent.click(confirmButton());
    act(() => state.onError?.(failure("billingQuoteChanged")));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe(ru.errors.billingQuoteChanged);
    expect(state.refetch).toHaveBeenCalledOnce();
    expect(onPrepared).not.toHaveBeenCalled(); expect(state.invalidate).not.toHaveBeenCalled();
    state.data = { ...fixture(), confirmationToken: "fresh-reviewed-token" };
    view.rerender(<TrialPreparation plan="STARTER" onPrepared={onPrepared} />);
    open(); expect(confirmButton().disabled).toBe(true);
    fireEvent.click(confirmation().getByRole("checkbox")); fireEvent.click(confirmButton());
    expect(state.mutate).toHaveBeenLastCalledWith({ plan: "STARTER", confirmationToken: "fresh-reviewed-token", confirmed: true });
  });

  it("does not turn an owner-permission failure into an upgrade prompt", () => {
    state.isError = true; state.error = failure("forbidden", "FORBIDDEN"); state.data = undefined;
    render(<TrialPreparation plan="STARTER" onPrepared={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain(ru.errors.forbidden);
    expect(screen.queryByRole("button", { name: ru.billing.trialPreparation.action })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: ru.common.tryAgain }));
    expect(state.refetch).toHaveBeenCalledOnce(); expect(state.mutate).not.toHaveBeenCalled();
  });

  it("keeps destructive controls disabled while the preparation request is in flight", () => {
    const view = render(<TrialPreparation plan="STARTER" onPrepared={vi.fn()} />); open();
    fireEvent.click(confirmation().getByRole("checkbox")); state.preparing = true;
    view.rerender(<TrialPreparation plan="STARTER" onPrepared={vi.fn()} />);
    expect((confirmation().getByRole("button", { name: ru.common.loading }) as HTMLButtonElement).disabled).toBe(true);
    expect((confirmation().getByRole("button", { name: ru.common.cancel }) as HTMLButtonElement).disabled).toBe(true);
    expect((confirmation().getByRole("checkbox") as HTMLButtonElement).disabled).toBe(true);
  });
});
