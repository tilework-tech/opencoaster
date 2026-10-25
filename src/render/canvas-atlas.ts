import type { SpritePages } from './sprite-pages';

export type CanvasAtlas = SpritePages;

/** Draws a native-size sprite frame with its anchor pixel on (x, y) in the current transform. */
export function drawAnchoredSprite(
  ctx: CanvasRenderingContext2D,
  atlas: CanvasAtlas,
  key: string,
  x: number,
  y: number,
  frameIndex = 0,
): boolean {
  const entry = atlas.resolve(key);
  const frame = entry?.frames[frameIndex] ?? entry?.frames[0];
  const image = frame && atlas.pageImage(frame.page);
  if (!entry || !frame || !image) return false;
  ctx.drawImage(
    image,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    Math.round(x - entry.anchor.x),
    Math.round(y - entry.anchor.y),
    frame.width,
    frame.height,
  );
  return true;
}

/**
 * Fills the unit tile diamond with a square tile-space texture frame (u along +x, v along +y),
 * with the diamond's top vertex at (x, y) in the current transform.
 */
export function drawTileTexture(
  ctx: CanvasRenderingContext2D,
  atlas: CanvasAtlas,
  key: string,
  frameIndex: number,
  x: number,
  y: number,
  tileWidth: number,
  tileHeight: number,
): boolean {
  const entry = atlas.resolve(key);
  const frame = entry?.frames[frameIndex % (entry?.frames.length || 1)];
  const image = frame && atlas.pageImage(frame.page);
  if (!entry || !frame || !image) return false;
  ctx.save();
  ctx.transform(
    tileWidth / 2 / frame.width,
    tileHeight / 2 / frame.width,
    -tileWidth / 2 / frame.height,
    tileHeight / 2 / frame.height,
    x,
    y,
  );
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    image,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    0,
    0,
    frame.width,
    frame.height,
  );
  ctx.restore();
  return true;
}
