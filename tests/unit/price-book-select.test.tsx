// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PriceBookSelect } from "@/components/products/price-book-select";

afterEach(cleanup);

it("selects an actual store and clears an optional price filter without leaking its UI sentinel", async () => {
  Element.prototype.scrollIntoView = vi.fn();
  const changed = vi.fn();
  function Filter() {
    const [value, setValue] = useState("");
    return (
      <PriceBookSelect
        label="Store source"
        value={value}
        onValueChange={(next) => {
          changed(next);
          setValue(next);
        }}
        emptyLabel="List only"
        options={[{ id: "store-two", name: "Second store" }]}
      />
    );
  }
  render(<Filter />);
  const trigger = screen.getByRole("combobox", { name: "Store source" });
  expect(trigger.textContent).toBe("List only");
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: "Second store" }));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith("store-two"));
  expect(trigger.textContent).toBe("Second store");
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: "List only" }));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(""));
  expect(trigger.textContent).toBe("List only");
});

it("shows an empty-list placeholder without creating a selectable blank price book", async () => {
  Element.prototype.scrollIntoView = vi.fn();
  const changed = vi.fn();
  render(
    <PriceBookSelect
      label="Price list"
      value=""
      onValueChange={changed}
      placeholder="Choose a list"
      options={[{ id: "book-one", name: "Retail list" }]}
    />,
  );
  const trigger = screen.getByRole("combobox", { name: "Price list" });
  expect(trigger.textContent).toBe("Choose a list");
  fireEvent.keyDown(trigger, { key: "Enter" });
  await screen.findByRole("listbox");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  fireEvent.click(screen.getByRole("option", { name: "Retail list" }));
  await waitFor(() => expect(changed).toHaveBeenCalledWith("book-one"));
});
