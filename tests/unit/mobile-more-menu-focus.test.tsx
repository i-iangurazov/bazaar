// @vitest-environment jsdom

import React, { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MobileMoreMenu } from "@/components/mobile-app-shell";

vi.mock("next/link", () => ({
  default: ({ children, onClick, prefetch: _prefetch, ...props }:
    React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
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
            sections={[]}
            profileItem={{ key: "profile", label: "Profile", href: "/settings/profile", icon: ItemIcon }}
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

describe("MobileMoreMenu sections", () => {
  it("reveals the current nested route and one section at a time, with direct Import and Billing links", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <MobileMoreMenu
        open
        title="Ещё"
        closeLabel="Закрыть"
        onClose={onClose}
        profileItem={{ key: "profile", label: "Профиль", href: "/settings/profile", icon: ItemIcon }}
        sections={[
          {
            key: "core",
            label: "Основное",
            icon: ItemIcon,
            active: true,
            children: [{
              key: "inventory",
              label: "Запасы",
              icon: ItemIcon,
              active: true,
              children: [{
                key: "stockCounts",
                label: "Инвентаризация",
                href: "/inventory/counts",
                icon: ItemIcon,
                active: true,
              }],
            }],
          },
          {
            key: "operations",
            label: "Операции",
            icon: ItemIcon,
            children: [{ key: "imports", label: "Импорт", href: "/settings/import", icon: ItemIcon }],
          },
          {
            key: "admin",
            label: "Администрирование",
            icon: ItemIcon,
            children: [{ key: "billing", label: "Тарифы", href: "/billing", icon: ItemIcon }],
          },
        ]}
      />,
    );

    const core = screen.getByRole("button", { name: "Основное" });
    const inventory = screen.getByRole("button", { name: "Запасы" });
    expect(core.getAttribute("aria-expanded")).toBe("true");
    expect(inventory.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Инвентаризация" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("link", { name: "Импорт" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Операции" }));
    expect(core.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("link", { name: "Импорт" }).getAttribute("href")).toBe("/settings/import");
    expect(screen.queryByRole("link", { name: "Инвентаризация" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Администрирование" }));
    const billing = screen.getByRole("link", { name: "Тарифы" });
    expect(billing.getAttribute("href")).toBe("/billing");
    expect(screen.queryByRole("link", { name: "Импорт" })).toBeNull();
    expect(screen.getByRole("link", { name: "Профиль" }).getAttribute("href")).toBe("/settings/profile");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDefined();
    await user.click(billing);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
