// @vitest-environment jsdom

import React, { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MobileMoreMenu } from "@/components/mobile-app-shell";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/language-switcher", () => ({
  LanguageSwitcher: () => <button type="button">Language</button>,
}));
vi.mock("@/components/pwa-install-button", () => ({
  PwaInstallButton: () => <button type="button">Install</button>,
}));
vi.mock("@/components/signout-button", () => ({
  SignOutButton: () => <button type="button">Sign out</button>,
}));

const ItemIcon = () => <span aria-hidden />;

describe("MobileMoreMenu focus lifecycle", () => {
  it("restores whichever mobile More trigger opened the sheet", async () => {
    const user = userEvent.setup();
    const Harness = () => {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Top More
          </button>
          <button type="button" onClick={() => setOpen(true)}>
            Bottom More
          </button>
          <MobileMoreMenu
            open={open}
            items={[{ key: "products", label: "Products", href: "/products", icon: ItemIcon }]}
            title="More"
            closeLabel="Close"
            onClose={() => setOpen(false)}
          />
        </div>
      );
    };

    render(<Harness />);

    for (const name of ["Top More", "Bottom More"]) {
      const trigger = screen.getByRole("button", { name });
      await user.click(trigger);
      const dialog = screen.getByRole("dialog", { name: "More" });
      expect(dialog.contains(document.activeElement)).toBe(true);
      await user.keyboard("{Escape}");
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    }
  });
});
