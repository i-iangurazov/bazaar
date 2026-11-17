/**
 * Keeps a horizontally scrollable region in sync with keyboard focus.
 *
 * Tabbing into a control near the right edge of a wide table otherwise leaves
 * only a few pixels of that control visible. Scrolling only horizontally avoids
 * fighting the browser's vertical focus scrolling.
 */
export const scrollChildIntoHorizontalView = (
  container: HTMLElement,
  target: EventTarget | null,
  padding = 12,
) => {
  if (!(target instanceof HTMLElement) || !container.contains(target)) {
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  if (targetRect.left < containerRect.left + padding) {
    container.scrollLeft -= containerRect.left + padding - targetRect.left;
  } else if (targetRect.right > containerRect.right - padding) {
    container.scrollLeft += targetRect.right - (containerRect.right - padding);
  }
};
