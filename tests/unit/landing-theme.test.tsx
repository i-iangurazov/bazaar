// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ path: "/", authenticated: false, theme: "DARK" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
vi.mock("next-auth/react", () => ({
  useSession: () =>
    state.authenticated
      ? { status: "authenticated", data: { user: { themePreference: state.theme } } }
      : { status: "unauthenticated", data: null },
}));
import { ThemeSync } from "@/components/theme-sync";
afterEach(() => {
  cleanup();
  document.documentElement.className = "";
});
describe("theme agreement across public and app routes", () => {
  it.each(["/", "/help", "/settings/profile"])(
    "preserves an anonymous server-selected dark theme on %s",
    (path) => {
      state.path = path;
      state.authenticated = false;
      document.documentElement.className = "dark";
      render(<ThemeSync />);
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    },
  );
  it.each(["/", "/help", "/settings/profile"])(
    "applies authenticated preference changes without forcing light on %s",
    (path) => {
      state.path = path;
      state.authenticated = true;
      state.theme = "DARK";
      const view = render(<ThemeSync />);
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.cookie).toContain("theme=dark");
      state.theme = "LIGHT";
      view.rerender(<ThemeSync />);
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.cookie).toContain("theme=light");
    },
  );
});
