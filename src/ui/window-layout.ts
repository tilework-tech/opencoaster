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
