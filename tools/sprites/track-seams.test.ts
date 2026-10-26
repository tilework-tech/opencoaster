import { describe, expect, it } from 'vitest';
import { TILE_UNITS, Z_STEP } from '../../src/sim/core/constants';
import {
  PIECES,
  TRANSPORT_PIECES as CATALOG_TRANSPORT_PIECES,
  pieceByName,
} from '../../src/sim/track/catalog';
import { pieceExit } from '../../src/sim/track/construction';
import { PieceMode } from '../../src/sim/track/track-types';
import { RIDE_CATALOG, RideType } from '../../src/sim/rides/ride-types';
import { supportOffset, supportStack } from '../../src/render/coaster-art';
import { trackCellSprites } from '../../src/render/coaster-art';
import { project } from '../../src/render/projection';
import type { Rotation } from '../../src/render/projection';
import { SAMPLES } from '../../src/sim/track/catalog';
import { transportSprites, waterTrackSprites } from './generate';
import { coasterSprites } from './models/coaster/sprites';
import { LEVELS_PER_TILE, offsetPoint, pieceFrames } from './models/coaster/frames';
import { rotatePoint } from './mesh';
import { TRANSPORT_PIECES } from './models/transport';
import { TRANSPARENT } from './raster';
import {
  chain,
  coasterKind,
  composeCells,
  composeModels,
  neighbours,
  transportKind,
  waterKind,
} from './track-compose';
import type { Canvas, TrackKind } from './track-compose';

const lookup = new Map(
  [...coasterSprites(), ...waterTrackSprites(), ...transportSprites()].map((s) => [s.key, s]),
);

/** Covered pixels of `a` with no covered pixel of `b` within one pixel, and the reverse. */
function unmatched(a: Canvas, b: Canvas): { bad: number; covered: number } {
  const near = (c: Canvas, x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= c.width || yy >= c.height) continue;
        if (c.pixels[yy * c.width + xx] !== TRANSPARENT) return true;
      }
    return false;
  };
  let bad = 0;
  let covered = 0;
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const inA = a.pixels[y * a.width + x] !== TRANSPARENT;
      const inB = b.pixels[y * a.width + x] !== TRANSPARENT;
      if (inA) covered++;
      if ((inA && !near(b, x, y)) || (inB && !near(a, x, y))) bad++;
    }
  return { bad, covered };
}

const waterPieces = (type: RideType) =>
  PIECES.filter((p) => RIDE_CATALOG[type].trackRules?.allowedPieces?.includes(p.id));

const KINDS: TrackKind[] = [
  coasterKind('steel', 'steel'),
  coasterKind('wood', 'wood'),
  coasterKind('wood', 'mouse'),
  coasterKind('junior', 'junior'),
  waterKind('log-flume', waterPieces(RideType.LogFlume)),
  waterKind('river-rapids', waterPieces(RideType.RiverRapids)),
  transportKind('miniature-railway', [...TRANSPORT_PIECES]),
  transportKind('monorail', [...TRANSPORT_PIECES]),
  transportKind('chairlift', [...TRANSPORT_PIECES]),
];

const CONTINUITY_ROUTES = [
  { name: 'oval', pieces: ['mediumRight', 'mediumRight', 'mediumRight', 'mediumRight'] },
  {
    name: 'figure eight crossover',
    pieces: [
      'mediumRight',
      'mediumRight',
      'mediumRight',
      'mediumRight',
      'mediumLeft',
      'mediumLeft',
      'mediumLeft',
      'mediumLeft',
    ],
  },
  { name: 'helix', pieces: ['smallHelixRightUp', 'smallHelixRightDown'] },
  {
    name: 'banked S-bends',
    pieces: [
      'flatToRightBank',
      'mediumRightBanked',
      'rightBankToFlat',
      'sBendRight',
      'flatToLeftBank',
      'mediumLeftBanked',
      'leftBankToFlat',
      'sBendLeft',
    ],
  },
  {
    name: 'slopes',
    pieces: ['flatToUp25', 'up25', 'up25ToFlat', 'flatToDown25', 'down25', 'down25ToFlat'],
  },
  { name: 'vertical loop', pieces: ['flat', 'verticalLoopRight', 'flat'] },
];

describe('placeable track sprite coverage', () => {
  it('keeps transport atlas eligibility limited to generated small turns', () => {
    const eligible = CATALOG_TRANSPORT_PIECES.map(({ name }) => name);
    expect(eligible).toContain('smallRight');
    expect(eligible).toContain('smallLeft');
    expect(eligible).not.toContain('mediumRight');
    expect(eligible).not.toContain('mediumLeft');
    expect(eligible).not.toContain('largeRight');
    expect(eligible).not.toContain('largeLeft');
  });

  it('provides water track art for every builder brake mode', () => {
    const flat = pieceByName('flat')!;
    for (const [rideType, family] of [
      [RideType.LogFlume, 'log-flume'],
      [RideType.RiverRapids, 'river-rapids'],
    ] as const) {
      expect(RIDE_CATALOG[rideType].trackRules?.allowedPieces).toContain(flat.id);
      for (const mode of [PieceMode.Brake, PieceMode.BlockBrake])
        for (let direction = 0; direction < 4; direction++)
          for (let rotation = 0; rotation < 4; rotation++)
            for (const cell of trackCellSprites(flat.id, direction, rotation, family, mode, 0))
              expect(lookup.get(cell.key.split('#')[0]!), cell.key).toBeDefined();
    }
  });

  for (const kind of KINDS) {
    it(`${kind.name}: every piece has opaque sprites in every direction and camera rotation`, () => {
      for (const piece of kind.pieces)
        for (let dir = 0; dir < 4; dir++)
          for (let rotation = 0; rotation < 4; rotation++) {
            const cells = kind.cells(piece, dir, rotation);
            expect(
              cells,
              `${kind.name} ${piece.name} direction ${dir} view ${rotation}`,
            ).toHaveLength(piece.footprint.length);
            for (const cell of cells) {
              const sprite = lookup.get(cell.key);
              expect(sprite, cell.key).toBeDefined();
              expect(
                sprite?.frames.every((frame) =>
                  frame.pixels.some((pixel) => pixel !== TRANSPARENT),
                ),
                cell.key,
              ).toBe(true);
            }
          }
    });
  }
});

describe('track piece models', () => {
  it('meet end to end: rails, height and cross-section agree at every connection', () => {
    const world = (
      x: number,
      y: number,
      z: number,
      dir: number,
      frame: ReturnType<typeof pieceFrames>[0],
      side: number,
      up: number,
    ) => {
      const local = offsetPoint(frame, side, up);
      const turned = rotatePoint([local[0], local[1], 0], dir);
      return [x + turned[0], y + turned[1], z / LEVELS_PER_TILE + local[2]];
    };
    const mapSize = 64;
    let pairs = 0;
    for (const a of PIECES)
      for (const b of PIECES) {
        if (a.exitSlope !== b.entrySlope || a.exitBank !== b.entryBank) continue;
        pairs++;
        for (let direction = 0; direction < 4; direction++) {
          const next = pieceExit(a.id, 10, 10, 8, direction);
          const end = pieceFrames(a).at(-1)!;
          const start = pieceFrames(b)[0];
          for (const [side, up] of [
            [0.1, 0],
            [-0.1, 0],
            [0, 0.1],
          ] as const) {
            const p = world(10, 10, 8, direction, end, side, up);
            const q = world(next.x, next.y, next.z, next.dir, start, side, up);
            const gap = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
            expect(gap, `${a.name} -> ${b.name}, direction ${direction}`).toBeLessThan(0.01);
            for (const rotation of [0, 1, 2, 3] as const) {
              const screen = (point: number[]) => {
                const result = new Float64Array(2);
                project(
                  point[0]! * TILE_UNITS,
                  point[1]! * TILE_UNITS,
                  point[2]! * TILE_UNITS,
                  mapSize,
                  mapSize,
                  rotation,
                  result,
                );
                return result;
              };
              const screenP = screen(p);
              const screenQ = screen(q);
              expect(
                Math.hypot(screenP[0]! - screenQ[0]!, screenP[1]! - screenQ[1]!),
                `${a.name} -> ${b.name}, direction ${direction}, view ${rotation}`,
              ).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    expect(pairs).toBeGreaterThan(300);
  });

  it('bank the inside of every banked turn lower than the outside', () => {
    for (const piece of PIECES.filter((p) => /Banked/.test(p.name))) {
      const frames = pieceFrames(piece);
      const mid = frames[Math.floor(frames.length / 2)];
      const right = offsetPoint(mid, 0.1, 0);
      const left = offsetPoint(mid, -0.1, 0);
      const turnsRight = piece.headingDelta === 1;
      expect(turnsRight ? right[2] : left[2], piece.name).toBeLessThan(
        turnsRight ? left[2] : right[2],
      );
    }
  });

  it('keep the cross-section upright at both ends of every inversion', () => {
    for (const piece of PIECES.filter((p) => /loop|corkscrew/i.test(p.name))) {
      const frames = pieceFrames(piece);
      for (const frame of [frames[0], frames.at(-1)!])
        expect(frame.up[2], piece.name).toBeGreaterThan(0.99);
    }
  });
});

describe('track cell sprites', () => {
  for (const kind of KINDS) {
    it(`${kind.name}: cells add up to the whole piece within a pixel in all four views`, () => {
      for (const piece of kind.pieces) {
        const { before, after } = neighbours(piece, kind.pieces);
        const names = [before?.name, piece.name, after?.name].filter((n): n is string => !!n);
        for (const dir of [0, 1, 2, 3])
          for (const rotation of [0, 1, 2, 3] as Rotation[]) {
            const placed = chain(names, { x: 20, y: 20, z: 10, dir });
            const cells = composeCells(kind, placed, rotation, lookup);
            const whole = composeModels(kind, placed, rotation, cells);
            const { bad, covered } = unmatched(cells, whole);
            expect(
              bad / covered,
              `${kind.name} ${piece.name} dir ${dir} view ${rotation}`,
            ).toBeLessThan(0.05);
          }
      }
    }, 120_000);
  }

  it('keeps real connected routes aligned to their canonical models in all camera rotations', () => {
    const kind = coasterKind('steel', 'steel');
    for (const route of CONTINUITY_ROUTES) {
      const placements = chain(route.pieces, { x: 28, y: 28, z: 12, dir: 0 });
      for (let index = 1; index < placements.length; index++) {
        const before = placements[index - 1]!.piece;
        const after = placements[index]!.piece;
        expect(
          [after.entrySlope, after.entryBank],
          `${route.name}: ${before.name} -> ${after.name}`,
        ).toEqual([before.exitSlope, before.exitBank]);
      }
      for (const rotation of [0, 1, 2, 3] as Rotation[]) {
        const cells = composeCells(kind, placements, rotation, lookup);
        const whole = composeModels(kind, placements, rotation, cells);
        const { bad, covered } = unmatched(cells, whole);
        expect(bad / covered, `${route.name}, view ${rotation}`).toBeLessThan(0.05);
      }
    }
  }, 120_000);

  it('keeps disconnected track endpoints visually separated in every camera rotation', () => {
    const kind = coasterKind('steel', 'steel');
    const placements = [
      { piece: pieceByName('flat')!, x: 24, y: 24, z: 12, dir: 0 },
      { piece: pieceByName('flat')!, x: 24, y: 26, z: 12, dir: 0 },
    ];
    for (const rotation of [0, 1, 2, 3] as Rotation[]) {
      const cells = composeCells(kind, placements, rotation, lookup);
      const first = composeModels(kind, [placements[0]!], rotation, cells);
      const second = composeModels(kind, [placements[1]!], rotation, cells);
      let nearest = Infinity;
      for (let y = 0; y < first.height; y++)
        for (let x = 0; x < first.width; x++) {
          if (first.pixels[y * first.width + x] === TRANSPARENT) continue;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= second.width || yy >= second.height) continue;
              if (second.pixels[yy * second.width + xx] !== TRANSPARENT) nearest = 0;
            }
        }
      expect(nearest, `view ${rotation}`).toBeGreaterThan(0);
    }
  }, 120_000);
});

describe('supports', () => {
  it('stand under the rails and end just below the underside of the track', () => {
    for (const piece of PIECES)
      piece.footprint.forEach((cell, index) => {
        const [x, y] = supportOffset(piece.id, index, 0);
        const column = [(cell.i + 0.5) * 256 + x, (cell.j + 0.5) * 256 + y];
        const onRail = Array.from(
          { length: piece.sampleCount },
          (_, k) => piece.sampleStart + k,
        ).some((at) => Math.hypot(SAMPLES.x[at] - column[0], SAMPLES.y[at] - column[1]) < 1);
        expect(onRail, `${piece.name} cell ${index}`).toBe(true);
        const stack = supportStack(piece.id, index, 0, 20);
        const top = stack.full + stack.quarters / 4;
        const rail = Math.min(
          ...Array.from({ length: piece.sampleCount }, (_, k) => piece.sampleStart + k)
            .filter((at) => Math.hypot(SAMPLES.x[at] - column[0], SAMPLES.y[at] - column[1]) < 1)
            .map((at) => 20 + SAMPLES.z[at] / Z_STEP),
        );
        expect(Math.abs(rail - top - 0.25), `${piece.name} cell ${index}`).toBeLessThanOrEqual(
          0.125,
        );
      });
  });
});
