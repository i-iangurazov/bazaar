// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MobileSaleProperty } from "@/components/pos/mobile-sale-property";

afterEach(cleanup);

describe("mobile sale properties", () => {
  it("shows document facts as text with no edit affordance", () => {
    const { container } = render(
      <>
        <MobileSaleProperty icon={null} label="Номер документа" value="POS-1001" />
        <MobileSaleProperty icon={null} label="Статус заказа" value="Черновик" />
        <MobileSaleProperty icon={null} label="Магазин" value="Центральный магазин" />
      </>,
    );
    expect(screen.getByText("POS-1001")).toBeTruthy();
    expect(screen.getByText("Черновик")).toBeTruthy();
    expect(screen.getByText("Центральный магазин")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("opens an available editor and keeps it unavailable during a pending save", async () => {
    const openDiscount = vi.fn();
    const property = <MobileSaleProperty icon={null} label="Скидка" value="50 сом" onEdit={openDiscount} />;
    const { rerender } = render(property);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Скидка 50 сом" }));
    expect(openDiscount).toHaveBeenCalledTimes(1);

    rerender(<MobileSaleProperty icon={null} label="Скидка" value="50 сом" onEdit={openDiscount} disabled />);
    await user.click(screen.getByRole("button", { name: "Скидка 50 сом" }));
    expect(openDiscount).toHaveBeenCalledTimes(1);
  });
});
