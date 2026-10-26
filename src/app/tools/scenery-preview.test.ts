import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScenerySpotPreview } from './scenery-preview';
import type { SceneryHover } from './scenery-preview';
import { SceneryItem, SceneryResult } from '../../sim/map/scenery';
import type { SimClient } from '../../worker/sim-client';

interface FakeElement {
  hidden: boolean;
  textContent: string;
  dataset: Record<string, string>;
  style: Record<string, string>;
  className: string;
  setAttribute(name: string, value: string): void;
  remove(): void;
}

function fakeElement(): FakeElement {
  return {
    hidden: false,
    textContent: '',
    dataset: {},
    style: {},
    className: '',
    setAttribute: () => {},
    remove: () => {},
  };
}

function hover(overrides: Partial<SceneryHover> = {}): SceneryHover {
  return {
    x: 4,
    y: 5,
    level: 2,
    slopeMask: 0,
    item: SceneryItem.OakTree,
    rotation: 0,
    viewRotation: 0,
    clientX: 100,
    clientY: 80,
    ...overrides,
  };
}

function fakeSim(result: SceneryResult): SimClient {
  return { previewScenery: vi.fn(async () => result) } as unknown as SimClient;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('scenery spot preview', () => {
  let label: FakeElement;
  let parent: { append: (el: FakeElement) => void };

  beforeEach(() => {
    vi.stubGlobal('document', { createElement: () => (label = fakeElement()) });
    parent = { append: () => {} };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws the piece translucent and priced at the cursor once the sim accepts the spot', async () => {
    const preview = new ScenerySpotPreview(parent as never, fakeSim(SceneryResult.Ok));
    expect(preview.update(hover(), 0)).toBeNull();
    await flush();
    expect(preview.update(hover(), 0)).toEqual({
      x: 4,
      y: 5,
      level: 2,
      width: 36,
      height: 36,
      sprite: 'trees/tree-oak',
      kind: 'scenery',
      tone: 'ok',
    });
    expect(label.hidden).toBe(false);
    expect(label.textContent).toContain('$1.50');
    expect(label.style.left).toBe('114px');
    expect(label.style.top).toBe('94px');
  });

  it('tints the piece red and states the reason when the sim refuses the spot', async () => {
    const preview = new ScenerySpotPreview(parent as never, fakeSim(SceneryResult.NotOwned));
    preview.update(hover(), 0);
    await flush();
    const ghost = preview.update(hover(), 0);
    expect(ghost?.tone).toBe('refused');
    expect(label.dataset.tone).toBe('refused');
    expect(label.textContent).toBe('Buy this land first.');
  });

  it('hides the preview when no tile is hovered', async () => {
    const preview = new ScenerySpotPreview(parent as never, fakeSim(SceneryResult.Ok));
    preview.update(hover(), 0);
    await flush();
    expect(preview.update(null, 0)).toBeNull();
    expect(label.hidden).toBe(true);
  });
});
