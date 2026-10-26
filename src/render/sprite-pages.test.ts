import { describe, expect, it, vi } from 'vitest';
import { SpritePages } from './sprite-pages';
import type { PageImage, SpritePageManifest } from './sprite-pages';

const manifest: SpritePageManifest = {
  pages: [
    {
      file: 'atlas/world-0.png',
      depthFile: 'atlas/world-0.depth.png',
      width: 64,
      height: 64,
      category: 'world',
    },
    {
      file: 'atlas/coaster-steel-0.png',
      depthFile: 'atlas/coaster-steel-0.depth.png',
      width: 64,
      height: 64,
      category: 'coaster-steel',
    },
  ],
  categories: {
    world: { lazy: false, pages: [0] },
    'coaster-steel': { lazy: true, pages: [1] },
  },
  sprites: {
    'terrain/grass': {
      category: 'world',
      frames: [{ page: 0, x: 0, y: 0, width: 8, height: 8 }],
      anchor: { x: 4, y: 8 },
      footprint: { width: 1, height: 1 },
    },
    'rides/coaster/steel/track': {
      category: 'coaster-steel',
      frames: [{ page: 1, x: 0, y: 0, width: 8, height: 8 }],
      anchor: { x: 4, y: 8 },
      footprint: { width: 1, height: 1 },
    },
  },
};

function makeStore() {
  const image = vi.fn(async (url: string) => ({ url }) as unknown as PageImage);
  const store = new SpritePages('/sprites/', { manifest: async () => manifest, image });
  return { store, image };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('sprite page loading', () => {
  it('loads each page together with its height page', async () => {
    const { store } = makeStore();
    store.start();
    await settle();

    expect(store.pageHeights(0)).toEqual({ url: '/sprites/atlas/world-0.depth.png' });
    expect(store.pageHeights(1)).toBeUndefined();
  });

  it('loads eager categories at start and leaves lazy categories unfetched', async () => {
    const { store, image } = makeStore();
    store.start();
    await settle();

    expect(image.mock.calls.map(([url]) => url)).toEqual([
      '/sprites/atlas/world-0.png',
      '/sprites/atlas/world-0.depth.png',
    ]);
    expect(store.resolve('terrain/grass')).toBeDefined();
  });

  it('loads a lazy category the first time one of its sprites is looked up', async () => {
    const { store, image } = makeStore();
    const arrived = vi.fn();
    store.onPagesLoaded(arrived);
    store.start();
    await settle();

    expect(store.resolve('rides/coaster/steel/track')).toBeUndefined();
    expect(store.resolve('rides/coaster/steel/track')).toBeUndefined();
    await settle();

    expect(image.mock.calls.map(([url]) => url)).toEqual([
      '/sprites/atlas/world-0.png',
      '/sprites/atlas/world-0.depth.png',
      '/sprites/atlas/coaster-steel-0.png',
      '/sprites/atlas/coaster-steel-0.depth.png',
    ]);
    expect(store.resolve('rides/coaster/steel/track')).toBeDefined();
    expect(arrived).toHaveBeenCalledTimes(2);
  });

  it('loads a lazy category on explicit request, such as when its build menu opens', async () => {
    const { store } = makeStore();
    store.start();
    await settle();

    store.requestCategory('coaster-steel');
    await settle();

    expect(store.isLoaded('coaster-steel')).toBe(true);
  });
});
