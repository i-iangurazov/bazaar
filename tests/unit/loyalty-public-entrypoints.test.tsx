// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ru from "../../messages/ru.json";
const state = vi.hoisted(() => ({ card: vi.fn(), target: vi.fn(), token: "synthetic-session", refresh: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: state.token }) }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => (ru.loyalty as Record<string, unknown>)[key] }));
vi.mock("@/server/services/loyalty/memberAuth", () => ({
  LOYALTY_SESSION_COOKIE: "loyalty_session", getCardView: state.card, resolveJoinTarget: state.target,
}));
vi.mock("@/app/loyalty/card/card-view", () => ({ LoyaltyCard: () => <p>confirmed-card</p> }));
vi.mock("@/app/loyalty/join/[programStoreId]/join-form", () => ({ LoyaltyJoinForm: () => <p>join-form</p> }));
import CardPage from "@/app/loyalty/card/page";
import JoinPage from "@/app/loyalty/join/[programStoreId]/page";
import { AppError } from "@/server/services/errors";
beforeEach(() => { vi.clearAllMocks(); state.token = "synthetic-session"; });
afterEach(cleanup);
const mount = (page: React.ReactNode) => render(<NextIntlClientProvider locale="ru" messages={{ loyalty: ru.loyalty, common: ru.common, errors: ru.errors, catalogPublic: ru.catalogPublic }}>{page}</NextIntlClientProvider>);

describe("public loyalty server entry recovery", () => {
  it("offers refresh for an initial card read failure, without claiming the session is gone", async () => {
    state.card.mockRejectedValue(new Error("database unavailable"));
    mount(await CardPage());
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(ru.loyalty.noSession)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: ru.common.tryAgain }));
    expect(state.refresh).toHaveBeenCalledOnce();
  });
  it("keeps the normal no-session state for an invalid token", async () => {
    state.card.mockRejectedValue(new AppError("loyaltyUnauthorized", "UNAUTHORIZED", 401));
    mount(await CardPage());
    expect(screen.getByText(ru.loyalty.noSession)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("does not attempt a card read without a session token", async () => {
    state.token = ""; mount(await CardPage());
    expect(state.card).not.toHaveBeenCalled();
    expect(screen.getByText(ru.loyalty.noSession)).toBeTruthy();
  });
  it("distinguishes a failed registration read from an unavailable programme", async () => {
    state.target.mockRejectedValue(new Error("database unavailable"));
    mount(await JoinPage({ params: { programStoreId: "synthetic-store" } }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(ru.loyalty.unavailable)).toBeNull();
    expect(screen.queryByText("join-form")).toBeNull();
  });
  it.each([null, { enabled: false }])("keeps missing or disabled programme access closed", async (target) => {
    state.target.mockResolvedValue(target);
    mount(await JoinPage({ params: { programStoreId: "synthetic-store" } }));
    expect(screen.getByText(ru.loyalty.unavailable)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("join-form")).toBeNull();
  });
});
