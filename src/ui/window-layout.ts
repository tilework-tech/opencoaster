/** Pure layout rules for floating windows. Below `MOBILE_MAX_WIDTH + 1` px windows become bottom sheets. */

export const MOBILE_MAX_WIDTH = 699;
export const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

/** Space reserved above (toolbar) and below (status bar) the windows on desktop. */
export const TOP_INSET = 40;
const BOTTOM_INSET = 30;
const GRAB = 40;

export function isMobileWidth(width: number): boolean {
  return width <= MOBILE_MAX_WIDTH;
}

export function effectiveGameSpeed(speed: number, constructionActive: boolean): number {
  return constructionActive ? Math.min(speed, 2) : speed;
}

export interface Point {
  x: number;
  y: number;
}

export function cascadePosition(
  index: number,
  viewportWidth: number,
  viewportHeight: number,
): Point {
  const step = 28;
  const slots = Math.max(1, Math.floor(Math.min(viewportHeight - 300, viewportWidth - 400) / step));
  const slot = index % slots;
  return { x: Math.max(16, viewportWidth - 380 - slot * step), y: TOP_INSET + 10 + slot * step };
}

/** Chooses a visible corner farthest from the pointer so new windows leave the map target clear. */
export function positionAwayFromPoint(
  fallback: Point,
  size: { width: number; height: number },
  point: Point,
  viewportWidth: number,
  viewportHeight: number,
): Point {
  const candidates = [
    { x: 16, y: TOP_INSET + 10 },
    { x: viewportWidth - size.width - 16, y: TOP_INSET + 10 },
    { x: 16, y: viewportHeight - BOTTOM_INSET - size.height - 10 },
    { x: viewportWidth - size.width - 16, y: viewportHeight - BOTTOM_INSET - size.height - 10 },
  ].map((candidate) =>
    clampPosition(candidate.x, candidate.y, size, viewportWidth, viewportHeight),
  );
  const vertical =
    point.y <= TOP_INSET + 180
      ? candidates.filter((candidate) => candidate.y > viewportHeight / 3)
      : candidates.filter((candidate) => candidate.y <= viewportHeight / 3);
  const clear = vertical.filter(
    (candidate) =>
      point.x < candidate.x - 24 ||
      point.x > candidate.x + size.width + 24 ||
      point.y < candidate.y - 24 ||
      point.y > candidate.y + size.height + 24,
  );
  const options = clear.length ? clear : [fallback];
  return options.reduce((best, candidate) => {
    const distance = (at: Point): number =>
      Math.hypot(at.x + size.width / 2 - point.x, at.y + size.height / 2 - point.y);
    return distance(candidate) > distance(best) ? candidate : best;
  });
}

/** Keeps at least `GRAB` px of the title bar on screen, and the bar below the toolbar. */
export function clampPosition(
  x: number,
  y: number,
  size: { width: number; height: number },
  viewportWidth: number,
  viewportHeight: number,
): Point {
  return {
    x: Math.min(viewportWidth - GRAB, Math.max(GRAB - size.width, x)),
    y: Math.min(viewportHeight - BOTTOM_INSET - 4, Math.max(TOP_INSET, y)),
  };
}
