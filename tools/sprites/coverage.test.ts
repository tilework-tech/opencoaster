import { describe, expect, it } from 'vitest';
import { RIDE_CATALOG } from '../../src/sim/rides/ride-types';
import { SCENERY_CATALOG } from '../../src/sim/map/scenery';
import {
  availableSpriteKeys,
  buildArtCoverage,
  renderArtCoverageHtml,
  spriteCoverageStatus,
} from './coverage';
import { PREPARED_PROP_SPRITES, PREPARED_TERRAIN_MATERIALS } from '../art/prepared-assets';

const rows = buildArtCoverage();

describe('art coverage inventory', () => {
  it('includes every ride and placeable scenery catalog entry', () => {
    const rides = rows.filter((row) => row.group === 'Ride');
    expect(rides.map((row) => row.item)).toHaveLength(Object.keys(RIDE_CATALOG).length);
    expect(rides.filter((row) => row.assetKeys.length === 0).map((row) => row.item)).toEqual([]);
    expect(rides.filter((row) => row.missing.length > 0).map((row) => row.item)).toEqual([]);
    expect(rows.filter((row) => row.group === 'Scenery').map((row) => row.item)).toHaveLength(
      SCENERY_CATALOG.length,
    );
  });

  it('provides authored sprite assets for every world catalog entry in both backends', () => {
    const worldRows = rows.filter((row) => row.assetKeys.length > 0);
    const uncovered = worldRows.filter(
      (row) => row.webgl2 !== 'sprite' || row.canvas2d !== 'sprite' || row.missing.length > 0,
    );
    expect(uncovered.map((row) => `${row.group}: ${row.item}: ${row.missing.join(', ')}`)).toEqual(
      [],
    );
  });

  it('reports runtime fallback when a required sprite key is unavailable', () => {
    expect(spriteCoverageStatus(['trees/tree-palm'], new Set())).toEqual({
      webgl2: 'placeholder',
      canvas2d: 'placeholder',
    });
  });

  it('checks generated and prepared sources for every scenery catalog key', () => {
    const available = availableSpriteKeys();
    const terrain = new Set(
      PREPARED_TERRAIN_MATERIALS.flatMap((material) => [
        ...Array.from(
          { length: 16 },
          (_, slope) => `terrain/${material}/shape-${slope.toString(16).padStart(2, '0')}`,
        ),
        `terrain/${material}/surface`,
        ...Array.from(
          { length: 4 },
          (_, direction) => `terrain/${material}/cliff-face-${direction}`,
        ),
      ]),
    );
    for (const key of [...PREPARED_PROP_SPRITES, ...terrain])
      expect(available.has(key), key).toBe(true);
    for (const item of SCENERY_CATALOG) {
      const key = item.sprite.startsWith('tree-')
        ? `trees/${item.sprite}`
        : `scenery/${item.sprite}`;
      expect(available.has(key), item.name).toBe(true);
    }
  });

  it('reports path additions, weather, UI, litter, and placement previews', () => {
    for (const item of [
      'rain shelter',
      'Flower bed',
      'lamp',
      'vandalised bench',
      'vandalised bin',
      'vandalised lamp',
    ])
      expect(
        rows.some((row) => row.item === item),
        item,
      ).toBe(true);
    for (const group of ['Litter', 'Weather', 'UI icon', 'Placement preview'])
      expect(
        rows.some((row) => row.group === group),
        group,
      ).toBe(true);
  });

  it('renders a readable development-only coverage report', () => {
    const html = renderArtCoverageHtml(rows);
    expect(html).toContain('OpenCoaster art coverage (development only)');
    expect(html).toContain('rain shelter');
    expect(html).toContain('Canvas2D');
    expect(html).toContain('WebGL2');
  });
});
