export type NativeHorizontalSafeArea = { left: number; right: number };
export type OverlayCollisionPadding = number | Partial<Record<"top" | "right" | "bottom" | "left", number>>;

/** Radix positions body portals against the viewport, outside AppShell padding. */
export function nativeHorizontalCollisionPadding(
  padding: OverlayCollisionPadding | undefined,
  safeArea: NativeHorizontalSafeArea,
): OverlayCollisionPadding | undefined {
  if (!safeArea.left && !safeArea.right) return padding;
  const sides = typeof padding === "number"
    ? { top: padding, right: padding, bottom: padding, left: padding } : padding ?? {};
  return { ...sides, left: safeArea.left + Math.max(0, sides.left ?? 0), right: safeArea.right + Math.max(0, sides.right ?? 0) };
}

/** Resolve CSS env()/test overrides once for all mounted native overlay users. */
export function createNativeHorizontalSafeArea(onChange: (value: NativeHorizontalSafeArea) => void) {
  const root = document.documentElement;
  const probe = document.createElement("div");
  probe.dataset.nativeSafeAreaProbe = "";
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
    "padding-left:var(--native-safe-area-left,env(safe-area-inset-left,0px));" +
    "padding-right:var(--native-safe-area-right,env(safe-area-inset-right,0px));";
  document.body.append(probe);
  let value: NativeHorizontalSafeArea = { left: 0, right: 0 };
  let frame = 0;
  let disposed = false;
  const pixels = (input: string) => Math.max(0, Number.parseFloat(input) || 0);
  const measure = () => {
    frame = 0;
    if (disposed) return;
    const style = getComputedStyle(probe);
    const next = root.classList.contains("native-ios")
      ? { left: pixels(style.paddingLeft), right: pixels(style.paddingRight) } : { left: 0, right: 0 };
    if (next.left !== value.left || next.right !== value.right) { value = next; onChange(value); }
  };
  const schedule = () => { if (!frame && !disposed) frame = window.requestAnimationFrame(measure); };
  const observer = new MutationObserver(schedule);
  observer.observe(root, { attributes: true, attributeFilter: ["class", "style"] });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("orientationchange", schedule, { passive: true });
  const visual = window.visualViewport;
  visual?.addEventListener("resize", schedule, { passive: true });
  measure();
  return { dispose: () => {
    disposed = true;
    if (frame) window.cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener("resize", schedule);
    window.removeEventListener("orientationchange", schedule);
    visual?.removeEventListener("resize", schedule);
    probe.remove();
  } };
}
