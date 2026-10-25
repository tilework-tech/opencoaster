import { describe, expect, it } from 'vitest';
import { TILE_UNITS } from '../../src/sim/core/constants';
import { RIDE_CATALOG } from '../../src/sim/rides/ride-types';
import { rideFootprintTiles } from '../../src/sim/rides/ride-footprint';
import { rotateTile } from '../../src/sim/track/construction';
import { project } from '../../src/render/projection';
import type { Rotation } from '../../src/render/projection';
import { rideCellView } from '../../src/render/world-art';
import { footprintCentre, placeOnFootprint, rideCellMesh } from './ride-cells';
import { project as rasterProject } from './raster';
import type { Mesh } from './mesh';
import { material } from './mesh';

const FLAT_RIDES = Object.values(RIDE_CATALOG).filter(
  (def) => !def.usesTrack && (def.category === 'gentle' || def.category === 'thrill'),
);
const MAP = 40;

function probeAt(x: number, y: number): Mesh {
  const m = material([0]);
  const d = 0.04;
  return [
    {
      v: [
        [x, y, 0],
        [x + d, y, 0],
        [x, y + d, 0],
      ],
      material: m,
    },
  ];
}

function screenOf(
  fx: number,
  fy: number,
  rotation: Rotation,
): [number, number] {
  const out = new Float64Array(2);
  project(fx, fy, 0, MAP, MAP, rotation, out);
  return [out[0], out[1]];
}

describe('flat ride slices land on the tile they belong to', () => {
  it('draws the slice of footprint tile i at that tile for every ride, orientation and camera', () => {
    const anchor = [17, 21] as const;
    for (const def of FLAT_RIDES)
      for (let dir = 0; dir < 4; dir++)
        for (let camera = 0 as Rotation; camera < 4; camera = (camera + 1) as Rotation) {
          const view = rideCellView(camera, dir);
          const tiles = rideFootprintTiles(def, anchor[0], anchor[1], dir);
          def.footprint.forEach(([fx, fy], j) => {
            // A point inside footprint tile j, in anchor-relative unrotated tile offsets.
            const local: [number, number] = [fx + 0.21, fy - 0.17];
            const probe = placeOnFootprint(
              probeAt(local[0], local[1]),
              def.footprint,
            );
            const [cx, cy] = footprintCentre(def.footprint);
            // placeOnFootprint shifts by the centre; undo so the probe sits at `local` exactly.
            const placed = probe.map((t) => ({
              ...t,
              v: t.v.map((p) => [p[0] - cx, p[1] - cy, p[2]]) as unknown as typeof t.v,
            }));
            const owners = def.footprint
              .map((_, i) => rideCellMesh(placed, def.footprint, i, view).length > 0)
              .map((has, i) => (has ? i : -1))
              .filter((i) => i >= 0);
            expect(owners, `${def.name} dir ${dir} cell ${j}`).toEqual([j]);

            const slice = rideCellMesh(placed, def.footprint, j, view);
            const [sx, sy] = rasterProject(...slice[0].v[0]);

            const [rx, ry] = rotateTile(local[0], local[1], dir);
            const probeWorld = screenOf(
              (anchor[0] + 0.5 + rx) * TILE_UNITS,
              (anchor[1] + 0.5 + ry) * TILE_UNITS,
              camera,
            );
            const tileCentre = screenOf(
              (tiles[j][0] + 0.5) * TILE_UNITS,
              (tiles[j][1] + 0.5) * TILE_UNITS,
              camera,
            );
            expect(tileCentre[0] + sx).toBeCloseTo(probeWorld[0], 4);
            expect(tileCentre[1] + sy).toBeCloseTo(probeWorld[1], 4);
          });
        }
  });

  it('keeps geometry that overhangs the footprint with the nearest edge tile', () => {
    const ship = RIDE_CATALOG[FLAT_RIDES.find((d) => d.name === 'Swinging Ship')!.id];
    const far = placeOnFootprint(probeAt(1.4, 0), ship.footprint);
    const owners = ship.footprint
      .map((_, i) => rideCellMesh(far, ship.footprint, i, 0).length > 0)
      .filter(Boolean);
    expect(owners).toHaveLength(1);
  });
});
