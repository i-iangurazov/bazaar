// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PwaInstallButton } from "@/components/pwa-install-button";
import { type BeforeInstallPromptEvent, detectPwaEnvironment, usePwaInstall } from "@/hooks/usePwaInstall";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    ({
      "buttonLabel": "Install app",
      "installedToast": "Installed",
      "close": "Close",
      "ios.title": "Install on iOS",
      "ios.subtitle": "Use Safari",
      "ios.steps.openSafari": "Open Safari",
      "ios.steps.tapShare": "Tap Share",
      "ios.steps.addToHome": "Add to Home Screen",
      "ios.steps.confirm": "Confirm Add",
      "safari.title": "Install from Safari",
      "safari.subtitle": "Safari can add app",
      "safari.steps.openSafari": "Keep Safari open",
      "safari.steps.openShare": "Use Share or File",
      "safari.steps.add": "Add to Dock",
      "safari.steps.confirm": "Confirm",
      "unsupported.title": "Unsupported browser",
      "unsupported.subtitle": "Use a supported browser",
      "unsupported.body": "Open Chrome or Safari.",
      "unsupported.httpsRequired": "HTTPS is required.",
      "browser.title": "Install from browser",
      "browser.subtitle": "Use browser install",
      "browser.body": "Choose Install app.",
    })[key] ?? key,
}));

vi.mock("@/components/ui/toast", async () => {
  const actual = await vi.importActual<typeof import("@/components/ui/toast")>(
    "@/components/ui/toast",
  );
  return {
    ...actual,
    useToast: () => ({ toast: vi.fn() }),
  };
});

const setUserAgent = (userAgent: string, vendor = "Google Inc.") => {
  Object.defineProperty(window.navigator, "userAgent", {
    value: userAgent,
    configurable: true,
  });
  Object.defineProperty(window.navigator, "vendor", {
    value: vendor,
    configurable: true,
  });
};

const setMatchMedia = (matches = false) => {
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("display-mode") ? matches : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
    configurable: true,
  });
};

const createPromptEvent = (outcome: "accepted" | "dismissed" = "accepted") => {
  const event = new Event("beforeinstallprompt") as BeforeInstallPromptEvent;
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
};

describe("PWA install utilities", () => {
  beforeEach(() => {
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
    );
    setMatchMedia(false);
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  });

  it("detects standalone mode so the install button can hide", () => {
    setMatchMedia(true);

    expect(detectPwaEnvironment(window).isInstalled).toBe(true);
  });

  it("captures Android/Chrome install prompt events and calls prompt()", async () => {
    const { result } = renderHook(() => usePwaInstall());
    const event = createPromptEvent("accepted");

    await waitFor(() => expect(result.current.isReady).toBe(true));
    act(() => {
      window.dispatchEvent(event);
    });

    await waitFor(() => expect(result.current.canPrompt).toBe(true));

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it("opens iOS install instructions instead of trying to trigger a native prompt", async () => {
    setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      "Apple Computer, Inc.",
    );

    render(<PwaInstallButton />);

    const button = await screen.findByRole("button", { name: "Install app" });
    fireEvent.click(button);

    expect(await screen.findByRole("dialog", { name: "Install on iOS" })).toBeTruthy();
    expect(screen.getByText("Add to Home Screen")).toBeTruthy();
  });

  it("opens Safari-specific install instructions instead of unsupported browser copy", async () => {
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
      "Apple Computer, Inc.",
    );

    render(<PwaInstallButton />);

    const button = await screen.findByRole("button", { name: "Install app" });
    fireEvent.click(button);

    expect(await screen.findByRole("dialog", { name: "Install from Safari" })).toBeTruthy();
    expect(screen.getByText("Add to Dock")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Unsupported browser" })).toBeNull();
  });

  it("shows guidance for unsupported in-app browsers", async () => {
    setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 350.0.0.0.0",
      "Apple Computer, Inc.",
    );

    render(<PwaInstallButton />);

    const button = await screen.findByRole("button", { name: "Install app" });
    fireEvent.click(button);

    expect(await screen.findByRole("dialog", { name: "Unsupported browser" })).toBeTruthy();
  });

  it("renders no install button in standalone mode", async () => {
    setMatchMedia(true);

    render(<PwaInstallButton />);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Install app" })).toBeNull();
    });
  });

  it("header source keeps install next to existing header actions", () => {
    const appShellSource = readFileSync(resolve(process.cwd(), "src/components/app-shell.tsx"), "utf8");

    expect(appShellSource).toContain("<PageTipsButton />\n            <PwaInstallButton />\n            <LanguageSwitcher />");
    expect(appShellSource).toContain("<PageTipsButton />\n                  <PwaInstallButton />\n                  <LanguageSwitcher />");
  });
});
