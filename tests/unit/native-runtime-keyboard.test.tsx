// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativeRuntime } from "@/components/native/native-runtime";

const state = vi.hoisted(() => ({
  listeners: new Map<string, (event?: { keyboardHeight: number }) => void>(),
  remove: vi.fn(), unsubscribe: vi.fn(),
  router: { push: vi.fn() }, query: { invalidateQueries: vi.fn() },
}));
vi.mock("@capacitor/keyboard", () => ({ Keyboard: {
  addListener: (name: string, listener: (event?: { keyboardHeight: number }) => void) => {
    state.listeners.set(name, listener); return Promise.resolve({ remove: state.remove });
  },
} }));
vi.mock("@capacitor/app", () => ({ App: {} }));
vi.mock("@capacitor/status-bar", () => ({ StatusBar: {}, Style: {} }));
vi.mock("@capacitor/splash-screen", () => ({ SplashScreen: {} }));
vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: {} }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => state.query }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "unauthenticated" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => state.router }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/native/apple-purchase-recovery", () => ({ ApplePurchaseRecovery: () => null }));
vi.mock("@/lib/native/platform", () => ({
  getNativePlatform: () => "ios", isNativeApp: () => true,
  isPluginAvailable: (name: string) => name === "Keyboard",
}));
vi.mock("@/lib/native/network", () => ({
  getConnectivitySnapshot: () => ({ state: "online" }),
  subscribeConnectivity: () => state.unsubscribe,
}));
vi.mock("@/lib/native/diagnostics", () => ({ reportNativeDiagnostic: vi.fn() }));

let visual: EventTarget & { height: number; offsetTop: number };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); state.listeners.clear();
  vi.stubGlobal("innerHeight", 844); vi.stubGlobal("innerWidth", 393);
  visual = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
  vi.stubGlobal("visualViewport", visual);
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals();
});
const tick = async () => { await act(async () => { vi.advanceTimersByTime(64); }); };

it("uses final native show/hide events, ignores stale visual state on hide, and cleans up", async () => {
  const root = document.documentElement;
  const view = render(<NativeRuntime />);
  await act(async () => {});
  expect([...state.listeners.keys()]).toEqual([
    "keyboardWillShow", "keyboardDidShow", "keyboardWillHide", "keyboardDidHide",
  ]);
  act(() => state.listeners.get("keyboardWillShow")!({ keyboardHeight: 300 }));
  await tick();
  expect(root.dataset.nativeKeyboard).toBe("visible");
  expect(root.style.getPropertyValue("--native-available-height")).toBe("544px");
  visual.height = 500;
  act(() => state.listeners.get("keyboardDidShow")!({ keyboardHeight: 300 }));
  await tick();
  expect(root.style.getPropertyValue("--native-available-height")).toBe("500px");
  act(() => state.listeners.get("keyboardWillHide")!());
  act(() => visual.dispatchEvent(new Event("resize")));
  await tick();
  expect(root.dataset.nativeKeyboard).toBe("hidden");
  expect(root.style.getPropertyValue("--native-keyboard-height")).toBe("0px");
  act(() => state.listeners.get("keyboardDidHide")!());
  visual.height = 844;
  act(() => visual.dispatchEvent(new Event("resize")));
  await tick();
  expect(root.style.getPropertyValue("--native-available-height")).toBe("844px");
  expect(root.dataset.nativeKeyboard).toBe("hidden");
  view.unmount(); await act(async () => {});
  expect(state.remove).toHaveBeenCalledTimes(4);
  expect(state.unsubscribe).toHaveBeenCalledOnce();
  expect(root.style.getPropertyValue("--native-available-height")).toBe("");
  act(() => state.listeners.get("keyboardDidShow")!({ keyboardHeight: 300 }));
  await tick();
  expect(root.dataset.nativeKeyboard).toBeUndefined();
});
