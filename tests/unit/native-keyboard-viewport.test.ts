// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNativeKeyboardViewport, nativeAvailableViewport } from "@/lib/native/keyboardViewport";

let viewport: ReturnType<typeof createNativeKeyboardViewport> | undefined;
let frames: Map<number, FrameRequestCallback>;
let serial: number;
let visual: EventTarget & { height: number; offsetTop: number };
const flush = () => {
  for (let turn = 0; frames.size && turn < 4; turn++) {
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback(0);
  }
  expect(frames.size).toBe(0);
};

beforeEach(() => {
  frames = new Map(); serial = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++serial, callback); return serial;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
  vi.stubGlobal("innerHeight", 844);
  vi.stubGlobal("innerWidth", 393);
  visual = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
  vi.stubGlobal("visualViewport", visual);
});
afterEach(() => {
  viewport?.dispose(); viewport = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("native keyboard visible viewport", () => {
  it.each([
    [844, 844, 0, 544], // configured body-only resize
    [544, 544, 0, 544], // viewport already resized: do not subtract again
    [844, 500, 0, 500], // visual viewport is the tighter bound
    [844, 500, 100, 544], // a panned viewport still respects the keyboard edge
  ])("bounds layout=%s visual=%s top=%s without double reduction", (innerHeight, visualHeight, visualTop, bottom) => {
    expect(nativeAvailableViewport({ closedHeight: 844, keyboardHeight: 300,
      innerHeight, visualHeight, visualTop })).toEqual({ bottom, top: visualTop });
  });

  it("handles no keyboard and invalid native dimensions without NaN styles", () => {
    expect(nativeAvailableViewport({ closedHeight: 844, keyboardHeight: 0, innerHeight: 844 })).toEqual({ bottom: 844, top: 0 });
    expect(nativeAvailableViewport({ closedHeight: 844, keyboardHeight: Number.NaN,
      innerHeight: 844, visualTop: Number.NaN })).toEqual({ bottom: 844, top: 0 });
  });

  it("recomputes on after-show/viewport change and restores after-hide without treating BODY height as viewport", () => {
    const root = document.documentElement;
    viewport = createNativeKeyboardViewport(root);
    viewport.show(300); flush();
    expect(root.style.getPropertyValue("--native-available-height")).toBe("544px");
    document.body.style.height = "544px";
    vi.stubGlobal("innerHeight", 544);
    visual.height = 544;
    window.dispatchEvent(new Event("resize")); viewport.show(300); flush();
    expect(root.style.getPropertyValue("--native-available-height")).toBe("544px");
    visual.height = 500; visual.dispatchEvent(new Event("resize")); flush();
    expect(root.style.getPropertyValue("--native-available-height")).toBe("500px");
    vi.stubGlobal("innerHeight", 844);
    visual.height = 844; viewport.hide(); flush();
    expect(root.style.getPropertyValue("--native-available-height")).toBe("844px");
    viewport.dispose(); viewport = undefined;
    visual.dispatchEvent(new Event("resize")); document.dispatchEvent(new Event("focusin")); flush();
    expect(root.style.getPropertyValue("--native-available-height")).toBe("");
    document.body.style.removeProperty("height");
  });

  it("reveals the focused field after show and focus change only inside its existing scrollable dialog", () => {
    document.body.innerHTML = `<section role="dialog"><form style="overflow-y:auto"><input id="first" value="retained" /><input id="second" /></form></section>`;
    const dialog = document.querySelector<HTMLElement>("section")!;
    const form = document.querySelector<HTMLElement>("form")!;
    const first = document.querySelector<HTMLInputElement>("#first")!;
    const second = document.querySelector<HTMLInputElement>("#second")!;
    const rect = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 300, width: 300, height, x: 0, y: top, toJSON: () => ({}) });
    vi.spyOn(dialog, "getBoundingClientRect").mockImplementation(() => rect(60, 440));
    vi.spyOn(form, "getBoundingClientRect").mockImplementation(() => rect(100, 380));
    vi.spyOn(first, "getBoundingClientRect").mockImplementation(() => rect(600 - form.scrollTop, 40));
    vi.spyOn(second, "getBoundingClientRect").mockImplementation(() => rect(900 - form.scrollTop, 40));
    Object.defineProperties(form, { clientHeight: { value: 380 }, scrollHeight: { value: 1000 } });
    const pageScroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const globalScroll = vi.fn(); first.scrollIntoView = globalScroll; second.scrollIntoView = globalScroll;
    viewport = createNativeKeyboardViewport(document.documentElement);
    first.focus(); viewport.show(300); flush();
    expect(form.scrollTop).toBe(168);
    expect(first.value).toBe("retained");
    second.focus(); flush();
    expect(form.scrollTop).toBe(468);
    expect(second.getBoundingClientRect().bottom).toBe(472);
    expect(document.activeElement).toBe(second);
    expect(pageScroll).not.toHaveBeenCalled(); expect(globalScroll).not.toHaveBeenCalled();
  });
});
