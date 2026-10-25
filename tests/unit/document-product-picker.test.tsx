// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentProductPicker } from "@/components/inventory/document-product-picker";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
beforeEach(() =>
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 0)),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Example({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const [search, setSearch] = useState("");
  return (
    <DocumentProductPicker title="Add products" initiallyOpen={initiallyOpen}>
      <label>
        Find product
        <input value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <button type="button">Add tea</button>
    </DocumentProductPicker>
  );
}

describe("document product picker", () => {
  it("opens with search focus, closes with Escape, and preserves the draft search", async () => {
    const user = userEvent.setup();
    render(<Example />);
    expect(screen.queryByRole("textbox", { name: "Find product" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "Add products" });
    await user.click(trigger);
    const input = screen.getByRole("textbox", { name: "Find product" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    await user.type(input, "Tea");
    await user.keyboard("{Escape}");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    await user.keyboard("{Enter}");
    expect((screen.getByRole("textbox", { name: "Find product" }) as HTMLInputElement).value).toBe(
      "Tea",
    );
  });

  it("keeps a restored receiving draft picker open on its initial render", () => {
    render(<Example initiallyOpen />);
    expect(screen.getByRole("textbox", { name: "Find product" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Add products" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });
});
