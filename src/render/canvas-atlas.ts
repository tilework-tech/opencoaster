export interface CanvasSpriteFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasSpriteEntry {
  frames: CanvasSpriteFrame[];
  anchor: { x: number; y: number };
  native?: boolean;
}

export interface CanvasAtlas {
  image: ImageBitmap;
  sprites: Record<string, CanvasSpriteEntry>;
}

let pending: Promise<CanvasAtlas | null> | null = null;

/** Loads the packed sprite atlas and manifest once; resolves to null when unavailable. */
export function loadCanvasAtlas(): Promise<CanvasAtlas | null> {
  if (pending) return pending;
  if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function')
    return Promise.resolve(null);
  const base = `${import.meta.env.BASE_URL}sprites/`;
  pending = (async () => {
    const manifestResponse = await fetch(`${base}manifest.json`);
    if (!manifestResponse.ok) return null;
    const manifest = (await manifestResponse.json()) as {
      sprites: Record<string, CanvasSpriteEntry>;
    };
    const imageResponse = await fetch(`${base}atlas.png`);
    if (!imageResponse.ok) return null;
    return {
      image: await createImageBitmap(await imageResponse.blob()),
      sprites: manifest.sprites,
    };
  })().catch(() => {
    pending = null;
    return null;
  });
  return pending;
}

/** Draws a native-size sprite frame with its anchor pixel on (x, y) in the current transform. */
export function drawAnchoredSprite(
  ctx: CanvasRenderingContext2D,
  atlas: CanvasAtlas,
  key: string,
  x: number,
  y: number,
): boolean {
  const entry = atlas.sprites[key];
  const frame = entry?.frames[0];
  if (!entry || !frame) return false;
  ctx.drawImage(
    atlas.image,
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
  const entry = atlas.sprites[key];
  const frame = entry?.frames[frameIndex % (entry?.frames.length || 1)];
  if (!entry || !frame) return false;
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
    atlas.image,
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
