// @vitest-environment jsdom
import { Capacitor } from "@capacitor/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNativeCollisionPadding } from "@/hooks/useNativeCollisionPadding";
import { nativeHorizontalCollisionPadding, type OverlayCollisionPadding } from "@/lib/native/horizontalSafeArea";

let insets: { left: number; right: number };
let frames: Map<number, FrameRequestCallback>;
let serial: number;
const flush = () => {
  const pending = [...frames.values()]; frames.clear();
  for (const callback of pending) callback(0);
};
const Probe = ({ name, padding }: { name: string; padding?: OverlayCollisionPadding }) =>
  <output aria-label={name}>{JSON.stringify(useNativeCollisionPadding(padding)) ?? "default"}</output>;
const result = (name: string) => JSON.parse(screen.getByLabelText(name).textContent!);

beforeEach(() => {
  insets = { left: 59, right: 12 }; frames = new Map(); serial = 0;
  document.documentElement.classList.add("native-ios");
  vi.spyOn(Capacitor, "getPlatform").mockReturnValue("ios");
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frames.set(++serial, callback); return serial; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
  const original = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    if (element.hasAttribute("data-native-safe-area-probe")) {
      const style = document.createElement("div").style;
      style.paddingLeft = `${insets.left}px`; style.paddingRight = `${insets.right}px`;
      return style;
    }
    return original(element, pseudo);
  });
});
afterEach(() => {
  cleanup(); document.documentElement.classList.remove("native-ios", "native-android");
  document.documentElement.style.removeProperty("--native-safe-area-left");
  expect(document.querySelector("[data-native-safe-area-probe]")).toBeNull();
  vi.restoreAllMocks();
});

describe("native horizontal collision bounds", () => {
  it("retains the caller's asymmetric padding and vertical minima", () => {
    expect(nativeHorizontalCollisionPadding({ top: 20, bottom: 30, left: 80, right: 4 }, insets))
      .toEqual({ top: 20, bottom: 30, left: 139, right: 16 });
    expect(nativeHorizontalCollisionPadding(8, insets)).toEqual({ top: 8, bottom: 8, left: 67, right: 20 });
    expect(nativeHorizontalCollisionPadding(undefined, insets)).toEqual({ left: 59, right: 12 });
    expect(nativeHorizontalCollisionPadding({ left: -100 }, insets)).toEqual({ left: 59, right: 12 });
  });

  it("preserves the original caller object/default when no inset applies", () => {
    const padding = { top: 20, left: 80 };
    expect(nativeHorizontalCollisionPadding(padding, { left: 0, right: 0 })).toBe(padding);
    expect(nativeHorizontalCollisionPadding(undefined, { left: 0, right: 0 })).toBeUndefined();
  });

  it("shares one measurement across overlays, rotates asymmetrically and removes only its probe/listeners", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const view = render(<><Probe key="one" name="one" padding={8} /><Probe key="two" name="two" padding={{ top: 20, right: 50 }} /></>);
    expect(document.querySelectorAll("[data-native-safe-area-probe]")).toHaveLength(1);
    expect(result("one")).toEqual({ top: 8, bottom: 8, left: 67, right: 20 });
    expect(result("two")).toEqual({ top: 20, right: 62, left: 59 });
    await act(async () => { insets = { left: 0, right: 59 }; fireEvent(window, new Event("orientationchange")); flush(); });
    expect(result("one")).toEqual({ top: 8, bottom: 8, left: 8, right: 67 });
    expect(result("two")).toEqual({ top: 20, right: 109, left: 0 });
    view.rerender(<Probe key="two" name="two" padding={{ top: 20, right: 50 }} />);
    expect(document.querySelectorAll("[data-native-safe-area-probe]")).toHaveLength(1);
    view.unmount();
    expect(remove.mock.calls.some(([type]) => type === "resize")).toBe(true);
    expect(remove.mock.calls.some(([type]) => type === "orientationchange")).toBe(true);
    fireEvent.resize(window); flush();
    expect(document.querySelector("[data-native-safe-area-probe]")).toBeNull();
  });

  it("observes native-class/CSS override changes without polling", async () => {
    render(<Probe name="bounds" padding={8} />);
    await act(async () => {
      insets = { left: 44, right: 21 };
      document.documentElement.style.setProperty("--native-safe-area-left", "44px");
      await Promise.resolve(); flush();
    });
    expect(result("bounds")).toEqual({ top: 8, bottom: 8, left: 52, right: 29 });
  });

  it.each(["web", "android"])("leaves %s props and runtime listeners unchanged", (platform) => {
    document.documentElement.classList.remove("native-ios");
    vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
    const add = vi.spyOn(window, "addEventListener");
    render(<Probe name="bounds" padding={{ top: 20, left: 80 }} />);
    expect(result("bounds")).toEqual({ top: 20, left: 80 });
    expect(document.querySelector("[data-native-safe-area-probe]")).toBeNull();
    expect(add.mock.calls.some(([type]) => type === "resize" || type === "orientationchange")).toBe(false);
  });
});
