export interface AtlasFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AtlasEntry {
  frames: AtlasFrame[];
  anchor: { x: number; y: number };
}

export interface SpriteAtlas {
  image: ImageBitmap;
  sprites: Record<string, AtlasEntry>;
}

/** Fetches the packed sprite atlas and its manifest; resolves to null when it is not deployed. */
export async function loadSpriteAtlas(): Promise<SpriteAtlas | null> {
  const base = `${import.meta.env.BASE_URL}sprites/`;
  const manifestResponse = await fetch(`${base}manifest.json`);
  if (!manifestResponse.ok) return null;
  const manifest = (await manifestResponse.json()) as { sprites: Record<string, AtlasEntry> };
  const imageResponse = await fetch(`${base}atlas.png`);
  if (!imageResponse.ok) return null;
  return { image: await createImageBitmap(await imageResponse.blob()), sprites: manifest.sprites };
}
