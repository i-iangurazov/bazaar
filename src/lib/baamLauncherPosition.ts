export type BaamControlRect = { left: number; top: number; right: number; bottom: number };

/** Keep the circle in its right-hand gutter, lifting it above intersecting controls. */
export function baamLauncherLift(base: BaamControlRect, controls: readonly BaamControlRect[], minTop = 80) {
  const height = base.bottom - base.top;
  const obstacles = controls.filter(rect => rect.right > base.left - 8 && rect.left < base.right + 8 && rect.bottom > minTop && rect.top < base.bottom + 8);
  let top = base.top;
  for (let step = 0; step <= obstacles.length; step++) {
    const hits = obstacles.filter(rect => rect.bottom + 8 > top && rect.top - 8 < top + height);
    if (!hits.length) return base.top - top;
    const next = Math.min(...hits.map(rect => rect.top - 8 - height));
    if (next < minTop) break;
    top = next;
  }
  // Dense full-height controls may leave no empty gap. Preserve the familiar
  // anchor instead of moving the trigger off screen or over the app header.
  return 0;
}
