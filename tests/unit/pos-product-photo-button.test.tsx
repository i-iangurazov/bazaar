// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PosProductPhotoButton } from "@/components/pos/product-photo-dialog";
import en from "../../messages/en.json";

afterEach(cleanup);

describe("POS product photo button", () => {
  const photo = { name: "Product", url: "/product.jpg" };
  const fixture = (disabled = false) => {
    const preview = vi.fn();
    const addProduct = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ pos: en.pos, common: en.common }}>
        <div onClick={addProduct}>
          <PosProductPhotoButton
            photo={photo}
            onPreview={preview}
            disabled={disabled}
            className="h-14 w-14"
            imageClassName="object-contain"
          />
        </div>
      </NextIntlClientProvider>,
    );
    return { preview, addProduct };
  };

  it("opens the photo by click, Enter or Space without adding the product and keeps focus", async () => {
    const user = userEvent.setup();
    const { preview, addProduct } = fixture();
    const button = screen.getByRole("button", { name: "View photo: Product" });
    await user.click(screen.getByRole("img", { name: "Product" }));
    expect(preview).toHaveBeenLastCalledWith(photo);
    expect(document.activeElement).toBe(button);
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(preview).toHaveBeenCalledTimes(3);
    expect(addProduct).not.toHaveBeenCalled();
  });

  it("respects a disabled product control", async () => {
    const user = userEvent.setup();
    const { preview, addProduct } = fixture(true);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("img", { name: "Product" }));
    expect(preview).not.toHaveBeenCalled();
    expect(addProduct).not.toHaveBeenCalled();
  });
});
