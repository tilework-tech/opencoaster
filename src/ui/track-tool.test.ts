import { describe, expect, it } from 'vitest';
import { PIECES, PieceId } from '../sim/track/catalog';
import { Bank, PieceMode, Slope, TrackResult } from '../sim/track/track-types';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import {
  TURN_LABELS,
  allowedModes,
  classifyPiece,
  feedbackMessage,
  footprintTiles,
  MODE_LABELS,
  previewStatus,
  resolvePiece,
} from './track-tool';
import type { PieceChoice } from './track-tool';
import { FeedbackDomain } from '../sim/core/feedback';
import { RideResult } from '../sim/rides/ride-results';
import type { OccupancyVolume } from '../sim/map/occupancy';
import { Z_STEP } from '../sim/core/constants';

const flatCursor = { hasTrack: true, slope: Slope.Flat, bank: Bank.None };
const choice = (over: Partial<PieceChoice>): PieceChoice => ({
  turn: 'straight',
  slope: Slope.Flat,
  bank: Bank.None,
  ...over,
});

describe('resolvePiece', () => {
  it('offers a flat straight and a lift hill start from flat track', () => {
    expect(resolvePiece(flatCursor, choice({}))?.id).toBe(PieceId.Flat);
    expect(resolvePiece(flatCursor, choice({ slope: Slope.Up25 }))?.id).toBe(PieceId.FlatToUp25);
  });

  it('continues a climb with the matching slope piece', () => {
    const climbing = { hasTrack: true, slope: Slope.Up25, bank: Bank.None };
    expect(resolvePiece(climbing, choice({ slope: Slope.Up25 }))?.id).toBe(PieceId.Up25);
    expect(resolvePiece(climbing, choice({ slope: Slope.Flat }))?.id).toBe(PieceId.Up25ToFlat);
    expect(resolvePiece(climbing, choice({ slope: Slope.Up60 }))?.id).toBe(PieceId.Up25ToUp60);
  });

  it('picks curves by direction and size, banked or not', () => {
    expect(resolvePiece(flatCursor, choice({ turn: 'smallRight' }))?.id).toBe(PieceId.SmallRight);
    expect(resolvePiece(flatCursor, choice({ turn: 'largeLeft' }))?.id).toBe(PieceId.LargeLeft);
    const banked = { hasTrack: true, slope: Slope.Flat, bank: Bank.Right };
    expect(resolvePiece(banked, choice({ turn: 'mediumRight', bank: Bank.Right }))?.id).toBe(
      PieceId.MediumRightBanked,
    );
  });

  it('starts banking from level track', () => {
    expect(resolvePiece(flatCursor, choice({ bank: Bank.Left }))?.id).toBe(PieceId.FlatToLeftBank);
  });

  it('returns nothing for a combination the catalog does not contain', () => {
    expect(resolvePiece(flatCursor, choice({ turn: 'smallLeft', slope: Slope.Up25 }))).toBe(
      undefined,
    );
  });

  it('lets a ride without track start with a station or any piece', () => {
    const empty = { hasTrack: false, slope: Slope.Flat, bank: Bank.None };
    expect(resolvePiece(empty, choice({ turn: 'station' }))?.id).toBe(PieceId.Station);
    expect(resolvePiece(empty, choice({ turn: 'loopRight' }))?.id).toBe(PieceId.VerticalLoopRight);
  });

  it('can reach every piece in the catalog from some cursor', () => {
    const reachable = new Set<number>();
    const turns = TURN_LABELS.map(([turn]) => turn);
    for (const piece of PIECES) {
      for (const turn of turns) {
        const found = resolvePiece(
          { hasTrack: true, slope: piece.entrySlope, bank: piece.entryBank },
          { turn, slope: piece.exitSlope, bank: piece.exitBank },
        );
        if (found) reachable.add(found.id);
      }
    }
    expect(reachable.size).toBe(PIECES.length);
  });

  it('gives every piece a unique place in the build controls', () => {
    const seen = new Map<string, string>();
    for (const piece of PIECES) {
      const key = [
        classifyPiece(piece),
        piece.entrySlope,
        piece.entryBank,
        piece.exitSlope,
        piece.exitBank,
      ].join('/');
      expect(seen.get(key), `${piece.name} collides with ${seen.get(key)}`).toBeUndefined();
      seen.set(key, piece.name);
    }
  });
});

describe('allowedModes', () => {
  it('limits drive modes by piece and by ride type', () => {
    const flat = PIECES[PieceId.Flat];
    expect(allowedModes(flat, RideType.SteelLoopingCoaster)).toEqual([
      PieceMode.Normal,
      PieceMode.ChainLift,
      PieceMode.Brake,
      PieceMode.BlockBrake,
      PieceMode.Launch,
    ]);
    expect(allowedModes(flat, RideType.WoodenCoaster)).not.toContain(PieceMode.Launch);
    expect(allowedModes(PIECES[PieceId.Station], RideType.WoodenCoaster)).toEqual([
      PieceMode.Normal,
    ]);
  });

  it.each([RideType.LogFlume, RideType.RiverRapids])(
    '%s offers a powered uphill mode instead of a coaster chain lift',
    (type) => {
      const modes = allowedModes(PIECES[PieceId.Up25], type).map((mode) => MODE_LABELS[mode]);
      expect(modes).toContain('Powered climb');
      expect(modes).not.toContain('Chain lift');
    },
  );
});

describe('footprintTiles', () => {
  it('rotates a curve footprint with the placement direction', () => {
    const right = footprintTiles(PIECES[PieceId.SmallRight], 10, 10, 0);
    const turned = footprintTiles(PIECES[PieceId.SmallRight], 10, 10, 1);
    expect(right.length).toBe(3);
    expect(turned).not.toEqual(right);
    expect(right[0]).toEqual([10, 10]);
  });
});

describe('previewStatus', () => {
  const buildable = new Uint8Array(16 * 16).fill(1);
  const map = { width: 16, height: 16 };
  it('flags tiles outside the map, unowned land and unaffordable pieces', () => {
    const piece = PIECES[PieceId.Flat];
    expect(previewStatus(map, buildable, piece, { x: 4, y: 4, dir: 0 }, 1_000_000)).toBe(
      TrackResult.Ok,
    );
    expect(previewStatus(map, buildable, piece, { x: -1, y: 4, dir: 0 }, 1_000_000)).toBe(
      TrackResult.OutOfBounds,
    );
    buildable[4 * 16 + 4] = 0;
    expect(previewStatus(map, buildable, piece, { x: 4, y: 4, dir: 0 }, 1_000_000)).toBe(
      TrackResult.NotOwned,
    );
    expect(previewStatus(map, buildable, piece, { x: 5, y: 4, dir: 0 }, 1)).toBe(
      TrackResult.InsufficientFunds,
    );
  });

  it('uses the selected ride type clearance when previewing track under an overpass', () => {
    const piece = PIECES[PieceId.Flat];
    const elevatedTrack: OccupancyVolume = {
      tileX: 4,
      tileY: 4,
      base: 4 * Z_STEP,
      clearance: 4 * Z_STEP + RIDE_CATALOG[RideType.SteelLoopingCoaster]!.trackClearanceWorld!,
      kind: 'track',
      name: 'Steel Looping Coaster 12',
    };
    expect(
      previewStatus(
        map,
        new Uint8Array(buildable.length).fill(1),
        piece,
        { x: 4, y: 4, dir: 0 },
        1_000_000,
        2,
        [elevatedTrack],
        RideType.SteelLoopingCoaster,
      ),
    ).toBe(TrackResult.Ok);
  });
});

describe('feedbackMessage', () => {
  it('describes every track and ride result for the player', () => {
    for (let code = 0; code <= TrackResult.OverWater; code++) {
      expect(feedbackMessage(FeedbackDomain.Track, code).text.length).toBeGreaterThan(0);
    }
    expect(feedbackMessage(FeedbackDomain.Track, TrackResult.OverWater).text).toContain(
      'open water',
    );
    for (let code = 0; code <= RideResult.TestPassed; code++) {
      expect(feedbackMessage(FeedbackDomain.Ride, code).text.length).toBeGreaterThan(0);
    }
  });

  it('marks failures as errors and successes as ok', () => {
    expect(feedbackMessage(FeedbackDomain.Track, TrackResult.NotOwned).ok).toBe(false);
    expect(feedbackMessage(FeedbackDomain.Track, TrackResult.Ok).ok).toBe(true);
    expect(feedbackMessage(FeedbackDomain.Ride, RideResult.TestPassed).ok).toBe(true);
    expect(feedbackMessage(FeedbackDomain.Ride, RideResult.TestFailed).ok).toBe(false);
  });

  it('includes the blocker and clearance location in track refusal feedback', () => {
    expect(
      feedbackMessage(
        FeedbackDomain.Track,
        TrackResult.Blocked,
        'Steel Looping Coaster 12 track above at (3, 8); needs 2 more levels',
      ).text,
    ).toBe('Blocked by Steel Looping Coaster 12 track above at (3, 8); needs 2 more levels.');
  });
});

describe('family-specific piece selection', () => {
  const typeByName = (name: string): RideType | undefined =>
    Object.values(RIDE_CATALOG).find((ride) => ride.name === name)?.id;
  it('hides steep slopes from junior coasters and inversions from wild mouse coasters', () => {
    expect(
      typeByName('Junior Roller Coaster'),
      'Junior Roller Coaster catalog entry',
    ).toBeDefined();
    expect(typeByName('Wild Mouse Coaster'), 'Wild Mouse Coaster catalog entry').toBeDefined();
    const junior = typeByName('Junior Roller Coaster');
    const wildMouse = typeByName('Wild Mouse Coaster');
    if (junior === undefined || wildMouse === undefined) return;
    expect(resolvePiece(flatCursor, choice({}), junior)?.id).toBe(PieceId.Flat);
    expect(resolvePiece(flatCursor, choice({}), wildMouse)?.id).toBe(PieceId.Flat);
    expect(resolvePiece(flatCursor, choice({ slope: Slope.Up60 }), junior)).toBeUndefined();
    expect(resolvePiece(flatCursor, choice({ turn: 'loopRight' }), wildMouse)).toBeUndefined();
    const climbingCursor = { ...flatCursor, hasTrack: true, slope: Slope.Up25 };
    expect(resolvePiece(climbingCursor, choice({ slope: Slope.Up60 }), wildMouse)).toBeDefined();
  });

  it('keeps transport curves buildable and blocks track without transport art', () => {
    for (const rideType of [RideType.MiniatureRailway, RideType.Monorail, RideType.Chairlift]) {
      expect(resolvePiece(flatCursor, choice({ turn: 'smallRight' }), rideType)?.id).toBe(
        PieceId.SmallRight,
      );
      expect(
        resolvePiece(flatCursor, choice({ turn: 'mediumRight', bank: Bank.Right }), rideType),
      ).toBeUndefined();
      expect(resolvePiece(flatCursor, choice({ slope: Slope.Up60 }), rideType)).toBeUndefined();
    }
  });
});

describe('previewStatus tunnel entries', () => {
  const W = 16;
  const buildable = new Uint8Array(W * W).fill(1);
  const hill = (vertex: (vx: number, vy: number) => number) => {
    const heights = new Uint8Array(W * W);
    const slope = new Uint8Array(W * W);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const c = [vertex(x, y), vertex(x + 1, y), vertex(x + 1, y + 1), vertex(x, y + 1)];
        const base = Math.min(...c);
        heights[y * W + x] = base;
        slope[y * W + x] = c.reduce((m, h, k) => m | (h > base ? 1 << k : 0), 0);
      }
    return { width: W, height: W, heights, slope };
  };
  const piece = PIECES[PieceId.Flat];

  it('refuses a piece that would enter the ground through a raised corner', () => {
    const corner = hill((vx, vy) => 5 + (vx === 7 && vy === 4 ? 1 : 0));
    expect(previewStatus(corner, buildable, piece, { x: 6, y: 4, dir: 0 }, 1_000_000, 5)).toBe(
      TrackResult.TunnelEntry,
    );
  });

  it('accepts a piece that enters the side of a hill', () => {
    const side = hill((vx) => 5 + Math.min(3, Math.max(0, vx - 6)));
    expect(previewStatus(side, buildable, piece, { x: 6, y: 4, dir: 0 }, 1_000_000, 5)).toBe(
      TrackResult.Ok,
    );
  });
});
