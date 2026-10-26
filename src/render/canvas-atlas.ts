import type { SpritePages } from './sprite-pages';
import { spriteAnchorScreenShift } from './ground-anchor';

export type CanvasAtlas = SpritePages;

/** Resolves a key (`name` or `name#frame`) to its frame and page image, or null when either is missing. */
function resolveFrame(atlas: CanvasAtlas, key: string, frameIndex?: number) {
  const hash = key.lastIndexOf('#');
  const spriteName = hash < 0 ? key : key.slice(0, hash);
  const selectedFrame = frameIndex ?? (hash < 0 ? 0 : Number(key.slice(hash + 1)));
  const entry = atlas.resolve(spriteName);
  const frame = entry?.frames[selectedFrame] ?? entry?.frames[0];
  const image = frame && atlas.pageImage(frame.page);
  if (!entry || !frame || !image) return null;
  return { entry, frame, image };
}

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
  const found = resolveFrame(atlas, key, frameIndex);
  if (!found) return false;
  const { entry, frame, image } = found;
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

const GHOST_ALPHA = 0.55;
const REFUSED_TINT = 'rgba(232, 40, 32, 0.6)';
let tintCanvas: HTMLCanvasElement | null = null;

/**
 * Draws a native-size sprite as a translucent placement preview, anchored like drawAnchoredSprite.
 * A refused preview keeps the sprite's shape and is tinted red.
 */
export function drawGhostSprite(
  ctx: CanvasRenderingContext2D,
  atlas: CanvasAtlas,
  key: string,
  x: number,
  y: number,
  tone: 'ok' | 'refused',
  width?: number,
  height?: number,
): boolean {
  const found = resolveFrame(atlas, key);
  if (!found) return false;
  const { entry, frame, image } = found;
  const renderedWidth = width ?? frame.width;
  const renderedHeight = height ?? frame.height;
  tintCanvas ??= document.createElement('canvas');
  tintCanvas.width = frame.width;
  tintCanvas.height = frame.height;
  const sprite = tintCanvas.getContext('2d');
  if (!sprite) return false;
  sprite.drawImage(
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
  if (tone === 'refused') {
    sprite.globalCompositeOperation = 'source-atop';
    sprite.fillStyle = REFUSED_TINT;
    sprite.fillRect(0, 0, frame.width, frame.height);
  }
  ctx.save();
  ctx.globalAlpha *= GHOST_ALPHA;
  ctx.drawImage(
    tintCanvas,
    0,
    0,
    frame.width,
    frame.height,
    x - renderedWidth / 2 + spriteAnchorScreenShift(frame.width, entry.anchor.x, renderedWidth),
    y - (entry.anchor.y / frame.height) * renderedHeight,
    renderedWidth,
    renderedHeight,
  );
  ctx.restore();
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
    x - width / 2 + spriteAnchorScreenShift(frame.width, entry.anchor.x, width),
    y - (entry.anchor.y / frame.height) * height,
    width,
    height,
  );
  return true;
}
