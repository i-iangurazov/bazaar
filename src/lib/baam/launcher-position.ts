export type LauncherObstacle = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  fixed: boolean;
  action: boolean;
};

/** Keep marked actions reachable; ordinary table rows never move the launcher. */
export function launcherBottom(width: number, height: number, obstacles: LauncherObstacle[]) {
  let space = width < 768 ? 96 : 24;
  const visible = obstacles.filter(
    (box) => box.top < height && box.bottom > 0 && box.right > box.left,
  );
  for (const box of visible) {
    if (box.fixed) space = Math.max(space, height - box.top + 12);
  }
  for (const box of visible.filter((box) => box.action).sort((a, b) => b.top - a.top)) {
    if (
      box.right > width - 144 &&
      box.left < width &&
      box.top < height - space + 12 &&
      box.bottom > height - space - 60
    )
      space = height - box.top + 12;
  }
  return Math.min(space, height - 116);
}
