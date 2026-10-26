import type { ObjectPickTarget } from '../../input/object-picking';
import { TILE_W } from '../../render/projection';

const OUTLINE_RGB = [255, 228, 107] as const;

/** How far a held person is raised above the ground, as a fraction of tile width. */
const LIFT_TILE_FRACTION = 0.25;

export function heldLiftPixels(zoom: number): number {
  return TILE_W * LIFT_TILE_FRACTION * zoom;
}

const OUTLINE_WIDTH = 2;
const OUTLINE_DIRECTIONS = 16;

function silhouette(target: ObjectPickTarget): HTMLCanvasElement {
  const mask = document.createElement('canvas');
  mask.width = target.alphaWidth;
  mask.height = target.alphaHeight;
  const context = mask.getContext('2d')!;
  const image = context.createImageData(mask.width, mask.height);
  for (let i = 0; i < target.alpha.length; i++) {
    if (target.alpha[i] === 0) continue;
    image.data.fill(255, i * 4, i * 4 + 4);
  }
  context.putImageData(image, 0, 0);
  return mask;
}

/**
 * Paints the combined silhouette of `targets` onto `canvas`: a bright outline around the visible
 * sprite pixels plus a light tint over them. Returns the screen-box origin the canvas covers,
 * relative to the viewport-local coordinates of the targets.
 */
export function drawSpriteOutline(
  canvas: HTMLCanvasElement,
  targets: readonly ObjectPickTarget[],
): { x: number; y: number } {
  const left = Math.floor(Math.min(...targets.map((t) => t.x))) - OUTLINE_WIDTH;
  const top = Math.floor(Math.min(...targets.map((t) => t.y))) - OUTLINE_WIDTH;
  const right = Math.ceil(Math.max(...targets.map((t) => t.x + t.width))) + OUTLINE_WIDTH;
  const bottom = Math.ceil(Math.max(...targets.map((t) => t.y + t.height))) + OUTLINE_WIDTH;
  const width = right - left;
  const height = bottom - top;
  const filled = document.createElement('canvas');
  filled.width = width;
  filled.height = height;
  const fillContext = filled.getContext('2d')!;
  fillContext.imageSmoothingEnabled = false;
  for (const target of targets)
    fillContext.drawImage(
      silhouette(target),
      target.x - left,
      target.y - top,
      target.width,
      target.height,
    );

  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext('2d')!;
  context.clearRect(0, 0, width, height);
  for (let i = 0; i < OUTLINE_DIRECTIONS; i++) {
    const angle = (i / OUTLINE_DIRECTIONS) * Math.PI * 2;
    context.drawImage(
      filled,
      Math.round(Math.cos(angle) * OUTLINE_WIDTH),
      Math.round(Math.sin(angle) * OUTLINE_WIDTH),
    );
  }
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = `rgb(${OUTLINE_RGB.join(' ')})`;
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = 'destination-out';
  context.drawImage(filled, 0, 0);
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 0.3;
  context.drawImage(tinted(filled), 0, 0);
  context.globalAlpha = 1;
  return { x: left, y: top };
}

function tinted(source: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const context = out.getContext('2d')!;
  context.drawImage(source, 0, 0);
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = `rgb(${OUTLINE_RGB.join(' ')})`;
  context.fillRect(0, 0, out.width, out.height);
  return out;
}

/** Pick targets that belong to the hovered object: a flat ride's body, entrance and exit move as one. */
export function hoverGroup(
  hovered: ObjectPickTarget,
  targets: readonly ObjectPickTarget[],
  flatRideIds: ReadonlySet<number>,
): ObjectPickTarget[] {
  if (hovered.kind !== 'ride' || hovered.rideId === undefined || !flatRideIds.has(hovered.rideId))
    return [hovered];
  return targets.filter((t) => t.kind === 'ride' && t.rideId === hovered.rideId);
}

/** Redraws a picked person's atlas sprite onto `canvas` at its on-screen size. */
export function drawHeldSprite(canvas: HTMLCanvasElement, target: ObjectPickTarget): boolean {
  const source = target.source;
  if (!source) return false;
  canvas.width = Math.max(1, Math.round(target.width));
  canvas.height = Math.max(1, Math.round(target.height));
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    source.image,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return true;
}
