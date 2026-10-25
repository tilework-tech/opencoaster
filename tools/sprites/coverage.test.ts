import { describe, expect, it } from 'vitest';
import { RIDE_CATALOG } from '../../src/sim/rides/ride-types';
import { SCENERY_CATALOG } from '../../src/sim/map/scenery';
import { buildArtCoverage, renderArtCoverageHtml } from './coverage';

const rows = buildArtCoverage();

describe('art coverage inventory', () => {
  it('includes every ride and placeable scenery catalog entry', () => {
    expect(rows.filter((row) => row.group === 'Ride').map((row) => row.item)).toHaveLength(
      Object.keys(RIDE_CATALOG).length,
    );
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

  it('reports path additions, weather, UI, litter, and placement previews', () => {
    for (const item of ['rain shelter', 'Flower bed', 'lamp', 'vandalised bench', 'vandalised bin'])
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
