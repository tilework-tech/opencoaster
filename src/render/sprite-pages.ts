export interface PageFrame {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteEntry {
  category: string;
  frames: PageFrame[];
  anchor: { x: number; y: number };
  footprint: { width: number; height: number };
  /** Drawn at frame size with the anchor on the projected point. */
  native?: boolean;
}

export interface SpritePageInfo {
  file: string;
  /** Height page laid out like `file` (see height-encoding.ts and docs.md "Occlusion model"). */
  depthFile: string;
  width: number;
  height: number;
  category: string;
}

export interface SpritePageManifest {
  pages: SpritePageInfo[];
  categories: Record<string, { lazy: boolean; pages: number[] }>;
  sprites: Record<string, SpriteEntry>;
}

export type PageImage = ImageBitmap;

export interface SpritePageSource {
  manifest(url: string): Promise<SpritePageManifest>;
  image(url: string): Promise<PageImage>;
}

const browserSource: SpritePageSource = {
  async manifest(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Sprite manifest request failed: ${response.status}`);
    return (await response.json()) as SpritePageManifest;
  },
  async image(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Sprite page request failed: ${response.status}`);
    // Height pages hold packed integers: decode them byte-exact.
    return createImageBitmap(await response.blob(), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
  },
};

/**
 * Atlas pages shared by both renderers. Eager categories load at start; a lazy category loads
 * the first time one of its sprites is looked up (or `requestCategory` is called, for example
 * when its build menu opens). Until a category is loaded its sprites resolve to undefined and
 * callers draw their procedural fallback.
 */
export class SpritePages {
  private manifest: SpritePageManifest | null = null;
  private readonly images = new Map<number, PageImage>();
  private readonly heights = new Map<number, PageImage>();
  private readonly loaded = new Set<string>();
  private readonly requested = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private started = false;
  /** Bumped whenever a page arrives, so renderers can tell when to re-sync their textures. */
  version = 0;

  constructor(
    private readonly baseUrl: string = `${import.meta.env.BASE_URL}sprites/`,
    private readonly source: SpritePageSource = browserSource,
  ) {}

  /** Fetches the manifest and the eager categories; safe to call every frame. */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.loadManifest().catch(() => {
      this.started = false;
    });
  }

  /** Installs an already-fetched manifest and page images (used by the loader and tests). */
  install(
    manifest: SpritePageManifest,
    images: ReadonlyMap<number, PageImage>,
    heights: ReadonlyMap<number, PageImage> = new Map(),
  ): void {
    this.manifest = manifest;
    this.started = true;
    for (const [category, info] of Object.entries(manifest.categories)) {
      if (info.pages.every((page) => images.has(page))) this.loaded.add(category);
    }
    for (const [page, image] of images) this.images.set(page, image);
    for (const [page, image] of heights) this.heights.set(page, image);
    this.version++;
  }

  get pageInfos(): readonly SpritePageInfo[] {
    return this.manifest?.pages ?? [];
  }

  pageImage(page: number): PageImage | undefined {
    return this.images.get(page);
  }

  /** The height page of a loaded atlas page. */
  pageHeights(page: number): PageImage | undefined {
    return this.heights.get(page);
  }

  get loadedPages(): ReadonlyMap<number, PageImage> {
    return this.images;
  }

  isLoaded(category: string): boolean {
    return this.loaded.has(category);
  }

  /** Subscribes to page arrivals; returns the unsubscribe function. */
  onPagesLoaded(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * The sprite entry when its category is loaded. Looking up a sprite of an unloaded category
   * starts loading that category and returns undefined.
   */
  resolve(name: string): SpriteEntry | undefined {
    const entry = this.manifest?.sprites[name];
    if (!entry) return undefined;
    if (this.loaded.has(entry.category)) return entry;
    this.requestCategory(entry.category);
    return undefined;
  }

  /** Starts loading a category's pages if they are not loaded or in flight. */
  requestCategory(category: string): void {
    const info = this.manifest?.categories[category];
    if (!info || this.loaded.has(category) || this.requested.has(category)) return;
    this.requested.add(category);
    void this.loadCategory(category, info.pages).catch(() => undefined);
  }

  private async loadManifest(): Promise<void> {
    this.manifest = await this.source.manifest(`${this.baseUrl}manifest.json`);
    for (const [category, info] of Object.entries(this.manifest.categories)) {
      if (!info.lazy) this.requestCategory(category);
    }
  }

  private async loadCategory(category: string, pages: readonly number[]): Promise<void> {
    const manifest = this.manifest!;
    const images = await Promise.all(
      pages.map(async (page) => {
        const info = manifest.pages[page];
        const [colour, heights] = await Promise.all([
          this.source.image(`${this.baseUrl}${info.file}`),
          this.source.image(`${this.baseUrl}${info.depthFile}`),
        ]);
        return [page, colour, heights] as const;
      }),
    );
    for (const [page, image, heights] of images) {
      this.images.set(page, image);
      this.heights.set(page, heights);
    }
    this.loaded.add(category);
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

/** The shared page store used by the active renderer and by UI that wants to prefetch a category. */
export const spritePages = new SpritePages();
