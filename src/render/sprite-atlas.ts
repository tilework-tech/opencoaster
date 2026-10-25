export interface AtlasFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AtlasSprite {
  frames: AtlasFrame[];
  anchor: { x: number; y: number };
}

export interface SpriteAtlas {
  image: HTMLImageElement;
  sprites: Record<string, AtlasSprite>;
}

export async function loadSpriteAtlas(): Promise<SpriteAtlas | null> {
  const base = `${import.meta.env.BASE_URL}sprites/`;
  const manifestResponse = await fetch(`${base}manifest.json`);
  if (!manifestResponse.ok) return null;
  const manifest = (await manifestResponse.json()) as { sprites: Record<string, AtlasSprite> };
  const image = new Image();
  image.src = `${base}atlas.png`;
  await image.decode();
  return { image, sprites: manifest.sprites };
}

export function drawAtlasSprite(
  context: CanvasRenderingContext2D,
  atlas: SpriteAtlas,
  key: string,
  frameIndex: number,
  x: number,
  y: number,
  alpha = 1,
  scale = 1,
): boolean {
  const entry = atlas.sprites[key];
  if (!entry || entry.frames.length === 0) return false;
  const frame =
    entry.frames[((frameIndex % entry.frames.length) + entry.frames.length) % entry.frames.length];
  context.save();
  context.globalAlpha *= alpha;
  context.imageSmoothingEnabled = false;
  context.drawImage(
    atlas.image,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    x - entry.anchor.x * scale,
    y - entry.anchor.y * scale,
    frame.width * scale,
    frame.height * scale,
  );
  context.restore();
  return true;
}
