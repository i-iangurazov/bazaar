type ViewportMetrics = {
  closedHeight: number;
  keyboardHeight: number;
  innerHeight: number;
  visualHeight?: number;
  visualTop?: number;
};

/** A bottom edge in layout-viewport CSS pixels, not another keyboard inset. */
export function nativeAvailableViewport(metrics: ViewportMetrics) {
  const positive = (value: number | undefined) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
  const inner = positive(metrics.innerHeight) ?? 1;
  const closed = positive(metrics.closedHeight) ?? inner;
  const keyboard = Number.isFinite(metrics.keyboardHeight) ? Math.max(0, metrics.keyboardHeight) : 0;
  const visualTop = Number.isFinite(metrics.visualTop) ? Math.max(0, metrics.visualTop ?? 0) : 0;
  const visualHeight = positive(metrics.visualHeight);
  // Body resize leaves fixed/dvh surfaces unchanged. Native or visual viewport
  // resize may already exclude the keyboard, so take the minimum, not a sum.
  const bottom = Math.max(1, Math.min(inner, Math.max(1, closed - keyboard),
    visualHeight === undefined ? inner : visualTop + visualHeight));
  return { bottom, top: Math.min(visualTop, bottom - 1) };
}

/** Scroll only existing inner dialog containers; never pan the locked page. */
export function revealNativeDialogFocus(bottom: number, top: number) {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) ||
      !focused.matches("input, textarea, select, button, [contenteditable='true']")) return;
  const dialog = focused.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  if (!dialog) return;
  const dialogBounds = dialog.getBoundingClientRect();
  for (let container = focused.parentElement; container; container = container.parentElement) {
    const isScrollable = /^(auto|scroll)$/.test(getComputedStyle(container).overflowY) &&
      container.scrollHeight > container.clientHeight;
    if (isScrollable) {
      const bounds = container.getBoundingClientRect();
      const field = focused.getBoundingClientRect();
      const visibleTop = Math.max(top, dialogBounds.top, bounds.top) + 8;
      const visibleBottom = Math.min(bottom, dialogBounds.bottom, bounds.bottom) - 8;
      if (visibleBottom > visibleTop) {
        const delta = field.top < visibleTop ? field.top - visibleTop
          : field.bottom > visibleBottom ? field.bottom - visibleBottom : 0;
        container.scrollTop = Math.max(0, Math.min(container.scrollHeight - container.clientHeight,
          container.scrollTop + delta));
      }
    }
    if (container === dialog) break;
  }
}

export function createNativeKeyboardViewport(root: HTMLElement) {
  let keyboardHeight = 0;
  let closedHeight = window.innerHeight;
  let width = window.innerWidth;
  let frame: number | undefined;
  let focusFrame: number | undefined;
  let active = true;
  const visual = window.visualViewport;
  const update = () => {
    frame = undefined;
    if (!active) return;
    const available = nativeAvailableViewport({ closedHeight, keyboardHeight,
      innerHeight: window.innerHeight, visualHeight: visual?.height, visualTop: visual?.offsetTop });
    root.style.setProperty("--native-available-height", `${available.bottom}px`);
    root.style.setProperty("--native-viewport-offset-top", `${available.top}px`);
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
    // Let the constrained form lay out before revealing its focused control.
    focusFrame = requestAnimationFrame(() => {
      focusFrame = undefined;
      if (active && (keyboardHeight > 0 || available.bottom < closedHeight - 80))
        revealNativeDialogFocus(available.bottom, available.top);
    });
  };
  const schedule = () => {
    if (!active) return;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  };
  const resize = () => {
    // With configured body resize an orientation change gives a new full layout
    // viewport. A same-width keyboard resize must retain the closed baseline.
    if (keyboardHeight === 0 || width !== window.innerWidth) closedHeight = window.innerHeight;
    width = window.innerWidth;
    schedule();
  };
  window.addEventListener("resize", resize);
  visual?.addEventListener("resize", schedule);
  visual?.addEventListener("scroll", schedule);
  document.addEventListener("focusin", schedule);
  update();
  return {
    show(height: number) {
      keyboardHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
      schedule();
    },
    hide() {
      keyboardHeight = 0;
      closedHeight = window.innerHeight;
      schedule();
    },
    dispose() {
      active = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
      window.removeEventListener("resize", resize);
      visual?.removeEventListener("resize", schedule);
      visual?.removeEventListener("scroll", schedule);
      document.removeEventListener("focusin", schedule);
      root.style.removeProperty("--native-available-height");
      root.style.removeProperty("--native-viewport-offset-top");
    },
  };
}
