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

const textInputTypes = new Set(["text", "search", "email", "tel", "url", "password", "number"]);
const focusMargin = 8;
const minimumKeyboardOverlap = 80;

function focusedKeyboardField() {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || focused.inputMode === "none" ||
      focused.matches(":disabled, [readonly]")) return null;
  if (focused instanceof HTMLInputElement) return textInputTypes.has(focused.type) ? focused : null;
  return focused instanceof HTMLTextAreaElement || focused.isContentEditable ? focused : null;
}

function revealInScroller(container: Element, field: HTMLElement, top: number, bottom: number) {
  const visibleTop = top + focusMargin;
  const visibleBottom = bottom - focusMargin;
  if (visibleBottom <= visibleTop) return;
  const bounds = field.getBoundingClientRect();
  const delta = bounds.top < visibleTop ? bounds.top - visibleTop
    : bounds.bottom > visibleBottom ? bounds.bottom - visibleBottom : 0;
  if (delta === 0) return;
  const nextTop = Math.max(0, Math.min(container.scrollHeight - container.clientHeight,
    container.scrollTop + delta));
  if (nextTop === container.scrollTop) return;
  if (typeof container.scrollTo === "function") container.scrollTo({ top: nextTop, behavior: "instant" });
  else container.scrollTop = nextTop;
}

/** Reveal an editable control without moving focus, changing its value, or scrolling a locked page. */
function revealKeyboardFocus(bottom: number, top: number) {
  const focused = focusedKeyboardField();
  if (!focused) return;
  const dialog = focused.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  const dialogBounds = dialog?.getBoundingClientRect();
  const page = document.scrollingElement ?? document.documentElement;
  for (let container = focused.parentElement; container && container !== page &&
    container !== document.body; container = container.parentElement) {
    const isScrollable = /^(auto|scroll)$/.test(getComputedStyle(container).overflowY) &&
      container.scrollHeight > container.clientHeight;
    if (isScrollable) {
      const bounds = container.getBoundingClientRect();
      const containerTop = Math.max(bounds.top, dialogBounds?.top ?? bounds.top);
      const containerBottom = Math.min(bounds.bottom, dialogBounds?.bottom ?? bounds.bottom);
      const visibleTop = Math.max(top, containerTop);
      const visibleBottom = Math.min(bottom, containerBottom);
      // An outer scroller may still need to move the whole pane into view.
      if (visibleBottom - visibleTop > 2 * focusMargin)
        revealInScroller(container, focused, visibleTop, visibleBottom);
      else revealInScroller(container, focused, containerTop, containerBottom);
    }
    if (container === dialog) break;
  }
  if (!dialog && !document.body.hasAttribute("data-scroll-locked")) {
    revealInScroller(page, focused, top, bottom);
  }
}

function createKeyboardViewport(root: HTMLElement, native: boolean) {
  let keyboardHeight = 0;
  let closedHeight = window.innerHeight;
  let width = window.innerWidth;
  let frame: number | undefined;
  let focusFrame: number | undefined;
  let revealOnUpdate = false;
  let active = true;
  const visual = window.visualViewport;
  const keyboardAttribute = "data-mobile-keyboard-open";
  const scrollRoomProperty = "--mobile-keyboard-scroll-room";
  const update = () => {
    frame = undefined;
    if (!active) return;
    const focused = focusedKeyboardField();
    if (width !== window.innerWidth || (keyboardHeight === 0 && !focused)) {
      closedHeight = window.innerHeight;
      width = window.innerWidth;
    }
    const available = nativeAvailableViewport({ closedHeight, keyboardHeight,
      innerHeight: window.innerHeight, visualHeight: visual?.height, visualTop: visual?.offsetTop });
    // Undo pinch scale for detection only. The actual visible bounds still guide scrolling.
    const unscaledHeight = visual ? visual.height * (visual.scale || 1) : window.innerHeight;
    const keyboardVisible = keyboardHeight > 0 ||
      Math.min(window.innerHeight, unscaledHeight) < closedHeight - minimumKeyboardOverlap;
    const editing = Boolean(focused && keyboardVisible);

    if (editing) {
      const overlap = window.innerHeight - (available.bottom - available.top);
      root.style.setProperty(scrollRoomProperty, `${Math.max(0, overlap)}px`);
    } else root.style.removeProperty(scrollRoomProperty);
    root.toggleAttribute(keyboardAttribute, editing);
    if (native || editing) {
      root.style.setProperty("--native-available-height", `${available.bottom}px`);
      root.style.setProperty("--native-viewport-offset-top", `${available.top}px`);
    } else {
      root.style.removeProperty("--native-available-height");
      root.style.removeProperty("--native-viewport-offset-top");
    }

    if (!editing || revealOnUpdate) {
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
      focusFrame = undefined;
      // Let the constrained form lay out before revealing its focused control.
      if (editing) focusFrame = requestAnimationFrame(() => {
        focusFrame = undefined;
        if (active) revealKeyboardFocus(available.bottom, available.top);
      });
    }
    revealOnUpdate = false;
  };
  const onVisualScroll = () => {
    if (active && frame === undefined) frame = requestAnimationFrame(update);
  };
  const scheduleReveal = () => {
    revealOnUpdate = true;
    onVisualScroll();
  };
  window.addEventListener("resize", scheduleReveal);
  visual?.addEventListener("resize", scheduleReveal);
  visual?.addEventListener("scroll", onVisualScroll);
  document.addEventListener("focusin", scheduleReveal);
  document.addEventListener("focusout", scheduleReveal);
  update();
  return {
    show(height: number) {
      keyboardHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
      scheduleReveal();
    },
    hide() {
      keyboardHeight = 0;
      closedHeight = window.innerHeight;
      scheduleReveal();
    },
    dispose() {
      active = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
      window.removeEventListener("resize", scheduleReveal);
      visual?.removeEventListener("resize", scheduleReveal);
      visual?.removeEventListener("scroll", onVisualScroll);
      document.removeEventListener("focusin", scheduleReveal);
      document.removeEventListener("focusout", scheduleReveal);
      root.removeAttribute(keyboardAttribute);
      root.style.removeProperty(scrollRoomProperty);
      root.style.removeProperty("--native-available-height");
      root.style.removeProperty("--native-viewport-offset-top");
    },
  };
}

export const createNativeKeyboardViewport = (root: HTMLElement) => createKeyboardViewport(root, true);
export const createWebKeyboardViewport = (root: HTMLElement) => createKeyboardViewport(root, false);
