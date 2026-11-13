// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PosReturnQuantityInput } from "@/components/pos/return-quantity-input";
import { parseQuantity } from "@/lib/quantity";

afterEach(cleanup);

function Fixture({ disabled = false, readOnly = false } = {}) {
  const [draft, setDraft] = useState("0");
  return (
    <>
      <PosReturnQuantityInput
        aria-label="Return quantity, available 2.5"
        value={draft}
        availableQuantity={2.5}
        onChange={setDraft}
        disabled={disabled}
        readOnly={readOnly}
      />
      <output aria-label="Selected quantity">{parseQuantity(draft) ?? 0}</output>
    </>
  );
}

describe("POS fractional return quantity in both receipt entry points", () => {
  it.each(["0,5", "0.5"])("keeps an incrementally typed %s as a partial half-unit return", async (draft) => {
    render(<Fixture />);
    const input = screen.getByRole("textbox");
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, draft);
    expect((input as HTMLInputElement).value).toBe(draft);
    expect(screen.getByLabelText("Selected quantity").textContent).toBe("0.5");
    expect(input.getAttribute("inputmode")).toBe("decimal");
  });

  it("preserves a trailing separator while typing and a thousandth-unit quantity", async () => {
    render(<Fixture />);
    const input = screen.getByRole("textbox");
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, "0,");
    expect((input as HTMLInputElement).value).toBe("0,");
    await user.type(input, "125");
    expect((input as HTMLInputElement).value).toBe("0,125");
    expect(screen.getByLabelText("Selected quantity").textContent).toBe("0.125");
  });

  it("keeps whole quantities and clears the selection for an empty draft", async () => {
    render(<Fixture />);
    const input = screen.getByRole("textbox");
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, "2");
    expect(screen.getByLabelText("Selected quantity").textContent).toBe("2");
    await user.clear(input);
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.getByLabelText("Selected quantity").textContent).toBe("0");
  });

  it.each(["3", "3,125", "3.125"])("clamps %s to the actual available fractional quantity", (draft) => {
    render(<Fixture />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: draft } });
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("2.5");
    expect(screen.getByLabelText("Selected quantity").textContent).toBe("2.5");
  });

  it("rejects invalid characters, negative values and excessive precision instead of stripping them into a larger refund", () => {
    render(<Fixture />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "0,5" } });
    for (const value of ["0,5kg", "-0.5", "0.1234", "0,5.1"]) {
      fireEvent.change(input, { target: { value } });
      expect((input as HTMLInputElement).value).toBe("0,5");
      expect(screen.getByLabelText("Selected quantity").textContent).toBe("0.5");
    }
  });

  it.each(["disabled", "readOnly"] as const)("retains %s behavior while a return is unavailable or pending", async (state) => {
    render(<Fixture {...{ [state]: true }} />);
    const input = screen.getByRole("textbox");
    const user = userEvent.setup();
    await user.type(input, "0.5");
    expect((input as HTMLInputElement).value).toBe("0");
  });

});
