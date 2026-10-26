// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({ push: vi.fn(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) =>
    Object.assign((key: string) => `${namespace}.${key}`, {
      has: (key: string) =>
        [
          "emailDeliveryFailed",
          "loyaltyOtpRateLimited",
          "loyaltyOtpInvalid",
          "loyaltyAuthUnavailable",
        ].includes(key),
    }),
}));
import { LoyaltyJoinForm } from "@/app/loyalty/join/[programStoreId]/join-form";

const response = (message?: string) => ({ ok: !message, json: async () => ({ message }) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", state.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("loyalty join recovery", () => {
  const request = () => {
    render(<LoyaltyJoinForm programStoreId="synthetic-link" />);
    fireEvent.change(screen.getByLabelText("loyalty.emailLabel"), {
      target: { value: "shopper@example.invalid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "loyalty.getCode" }));
  };
  it.each(["emailDeliveryFailed", "loyaltyOtpRateLimited", "loyaltyAuthUnavailable"])(
    "shows the translated %s without a fake code stage",
    async (message) => {
      state.fetch.mockResolvedValue(response(message));
      request();
      expect((await screen.findByRole("alert")).textContent).toBe(`errors.${message}`);
      expect(state.push).not.toHaveBeenCalled();
      expect(
        (screen.getByRole("button", { name: "loyalty.getCode" }) as HTMLButtonElement).disabled,
      ).toBe(false);
    },
  );
  it("permits retry after delivery failure, then verifies the code and opens the existing card", async () => {
    state.fetch
      .mockResolvedValueOnce(response("emailDeliveryFailed"))
      .mockResolvedValue(response());
    request();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "loyalty.getCode" }));
    const code = await screen.findByLabelText("loyalty.codeLabel");
    expect(document.activeElement).toBe(code);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "loyalty.confirm" }));
    await waitFor(() => expect(state.push).toHaveBeenCalledWith("/loyalty/card"));
    expect(state.fetch.mock.calls[2][0]).toBe("/api/loyalty/otp/verify");
  });
  it("keeps the code field and session closed when verification fails", async () => {
    state.fetch.mockResolvedValueOnce(response()).mockResolvedValue(response("loyaltyOtpInvalid"));
    request();
    fireEvent.change(await screen.findByLabelText("loyalty.codeLabel"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "loyalty.confirm" }));
    expect((await screen.findByRole("alert")).textContent).toBe("errors.loyaltyOtpInvalid");
    expect(screen.getByLabelText("loyalty.codeLabel")).toBeTruthy();
    expect(state.push).not.toHaveBeenCalled();
  });
});
