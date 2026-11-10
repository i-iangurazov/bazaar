// @vitest-environment jsdom
import { createRef } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PriceInput } from "@/components/ui/price-input";
import { optionalPriceInputSchema, parsePriceInput } from "@/lib/priceInput";

afterEach(cleanup);

const schema = z.object({ price: optionalPriceInputSchema("Invalid price", "Negative price") });

function PriceForm({
  onSave,
  initialValue = 68,
}: {
  onSave: (amount: number | undefined) => void;
  initialValue?: number;
}) {
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { price: initialValue },
  });
  return (
    <form onSubmit={form.handleSubmit((values) => onSave(values.price))}>
      <Controller
        name="price"
        control={form.control}
        render={({ field }) => (
          <PriceInput {...field} value={field.value ?? ""} aria-label="Price" min={0} step="0.01" />
        )}
      />
      {form.formState.errors.price ? (
        <p role="alert">{form.formState.errors.price.message}</p>
      ) : null}
      <button type="submit">Save</button>
    </form>
  );
}

describe("locale-independent product price entry", () => {
  it.each(["68,50", "68.50"])(
    "submits %s as the same numeric amount through the form resolver",
    async (raw) => {
      const save = vi.fn();
      render(<PriceForm onSave={save} />);
      const input = screen.getByLabelText("Price") as HTMLInputElement;
      expect(input.type).toBe("text");
      expect(input.inputMode).toBe("decimal");
      fireEvent.change(input, { target: { value: raw } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(save).toHaveBeenCalledWith(68.5));
      expect(input.value).toBe(raw);
    },
  );

  it.each([",", "."])(
    "keeps a trailing %s while typing and lets the next digit extend it",
    async (separator) => {
      const save = vi.fn();
      render(<PriceForm onSave={save} />);
      const input = screen.getByLabelText("Price") as HTMLInputElement;
      fireEvent.change(input, { target: { value: `68${separator}` } });
      fireEvent.blur(input);
      expect(input.value).toBe(`68${separator}`);
      fireEvent.change(input, { target: { value: `68${separator}5` } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(save).toHaveBeenCalledWith(68.5));
    },
  );

  it.each(["68,5x", "68,501", "68.501", "68,5.0", "1e3", "Infinity"])(
    "blocks malformed or overly precise draft %s without saving",
    async (raw) => {
      const save = vi.fn();
      render(<PriceForm onSave={save} />);
      fireEvent.change(screen.getByLabelText("Price"), { target: { value: raw } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect((await screen.findByRole("alert")).textContent).toBe("Invalid price");
      expect(save).not.toHaveBeenCalled();
    },
  );

  it("preserves the non-negative validation and does not turn a cleared price into zero", async () => {
    const save = vi.fn();
    render(<PriceForm onSave={save} />);
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "-0,50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Negative price");
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(undefined));
  });

  it("retains precision of an existing numeric cost or foreign-currency conversion", async () => {
    const save = vi.fn();
    const existing = 700 / 87;
    render(<PriceForm onSave={save} initialValue={existing} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(existing));
  });

  it("forwards the real field ref, accessible state and existing disabled styling", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <PriceInput ref={ref} disabled aria-label="Price" aria-invalid className="existing-style" />,
    );
    expect(ref.current).toBe(screen.getByLabelText("Price"));
    expect(ref.current?.disabled).toBe(true);
    expect(ref.current?.getAttribute("aria-invalid")).toBe("true");
    expect(ref.current?.className).toContain("existing-style");
  });

  it("does not round typed amounts, strip bad characters or guess thousands separators", () => {
    expect(parsePriceInput("68,500")).toBe(68.5);
    expect(parsePriceInput("0,00")).toBe(0);
    expect(parsePriceInput(".50")).toBe(0.5);
    expect(parsePriceInput("9 999,00")).toBeNull();
    expect(parsePriceInput("1,000,000")).toBeNull();
    expect(parsePriceInput({ value: "68,50" })).toBeNull();
    expect(parsePriceInput(NaN)).toBeNull();
  });
});
