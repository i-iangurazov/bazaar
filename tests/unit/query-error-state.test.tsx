// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { QueryErrorState } from "@/components/query-error-state";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

describe("QueryErrorState", () => {
  it("shows a translated error and exposes a working retry action", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(<QueryErrorState onRetry={onRetry} />);

    expect(screen.getByRole("alert").textContent).toContain("errors.genericMessage");
    await user.click(screen.getByRole("button", { name: "common.tryAgain" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
