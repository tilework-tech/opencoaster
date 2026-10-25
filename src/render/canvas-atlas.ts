import type { SpritePages } from './sprite-pages';

export type CanvasAtlas = SpritePages;

/**
 * Draws a native-size sprite frame with its anchor pixel on (x, y) in the current transform.
 * A key ending in `#n` selects animation frame n.
 */
export function drawAnchoredSprite(
  ctx: CanvasRenderingContext2D,
  atlas: CanvasAtlas,
  key: string,
  x: number,
  y: number,
  frameIndex?: number,
): boolean {
  const hash = key.lastIndexOf('#');
  const spriteName = hash < 0 ? key : key.slice(0, hash);
  const selectedFrame = frameIndex ?? (hash < 0 ? 0 : Number(key.slice(hash + 1)));
  const entry = atlas.resolve(spriteName);
  const frame = entry?.frames[selectedFrame] ?? entry?.frames[0];
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

/**
 * Draws one atlas frame stretched to `width` x `height`, horizontally centred on `x` with the
 * sprite's anchor row on `y`, matching how the WebGL renderer places boxed sprites.
 */
export function drawBoxedSprite(
  ctx: CanvasRenderingContext2D,
  atlas: CanvasAtlas,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const [key, frameText] = name.split('#');
  const entry = atlas.resolve(key);
  if (!entry || entry.frames.length === 0) return false;
  const count = entry.frames.length;
  const frame = entry.frames[(((Number(frameText ?? 0) % count) + count) % count) | 0];
  const image = atlas.pageImage(frame.page);
  if (!image) return false;
  ctx.drawImage(
    image,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    x - width / 2,
    y - (entry.anchor.y / frame.height) * height,
    width,
    height,
  );
  return true;
}
