import { describe, expect, it } from 'vitest';
import { PIECES, pieceByName } from '../sim/track/catalog';
import { PieceMode } from '../sim/track/track-types';
import { RideType } from '../sim/rides/ride-types';
import {
  CHAIN_FRAMES,
  carSpriteKey,
  coasterFamily,
  trackedRideFamily,
  artPieces,
  familyPieces,
  trackArt,
  supportStack,
  trackCellSprites,
  trackVariant,
  transportCarSpriteKey,
  transportFamily,
  transportTrackCells,
} from './coaster-art';

describe('coaster families', () => {
  it('maps each coaster ride type to its own art family', () => {
    expect(coasterFamily(RideType.WoodenCoaster)).toBe('wood');
    expect(coasterFamily(RideType.SteelLoopingCoaster)).toBe('steel');
    expect(coasterFamily(RideType.JuniorRollerCoaster)).toBe('junior');
    expect(coasterFamily(RideType.WildMouseCoaster)).toBe('mouse');
    expect(coasterFamily(RideType.MerryGoRound)).toBeUndefined();
  });

  it('maps tracked water rides to their own render families', () => {
    expect(trackedRideFamily(RideType.LogFlume)).toBe('log-flume');
    expect(trackedRideFamily(RideType.RiverRapids)).toBe('river-rapids');
    expect(trackedRideFamily(RideType.WildMouseCoaster)).toBe('mouse');
  });
});

describe('transport art', () => {
  it('maps each track transport to its own sprite family', () => {
    expect(transportFamily(RideType.Chairlift)).toBe('chairlift');
    expect(transportFamily(RideType.MiniatureRailway)).toBe('miniature-railway');
    expect(transportFamily(RideType.Monorail)).toBe('monorail');
    expect(transportFamily(RideType.WoodenCoaster)).toBeUndefined();
  });

  it('selects rotated transport track and vehicle keys', () => {
    const cells = transportTrackCells(pieceByName('flat')!.id, 1, 2, 'monorail');
    expect(cells[0].key).toBe('track/monorail/flat/view-3/cell-0');
    expect(transportCarSpriteKey('chairlift', 1, 0, 1)).toBe(
      'vehicles/chairlift/car/flat/heading-3',
    );
  });
});

describe('family pieces', () => {
  it('limits each family to the pieces its ride type can build', () => {
    const names = (family: Parameters<typeof familyPieces>[0]) =>
      familyPieces(family).map((piece) => piece.name);
    expect(names('wood')).not.toContain('up60');
    expect(names('wood')).not.toContain('verticalLoopLeft');
    expect(names('wood')).toContain('largeHelixLeftUp');
    expect(names('steel')).toContain('verticalLoopLeft');
    expect(names('steel')).toContain('up60');
    expect(names('junior')).toHaveLength(16);
    expect(names('mouse')).toContain('up60');
    expect(names('mouse')).not.toContain('verticalLoopLeft');
  });

  it('includes sloped turns only in coaster families whose sim rules allow them', () => {
    const slopedTurns = PIECES.filter((piece) =>
      /^(small|medium|large)(Left|Right)(LeftBanked|RightBanked)?(Up25|Down25)$/.test(piece.name),
    );
    expect(slopedTurns).toHaveLength(24);
    const allowed = (family: Parameters<typeof familyPieces>[0]) =>
      new Set(familyPieces(family).map((piece) => piece.id));
    for (const family of ['wood', 'steel', 'mouse'] as const) {
      const ids = allowed(family);
      expect(
        slopedTurns.filter((piece) => ids.has(piece.id)),
        family,
      ).toHaveLength(24);
    }
    const junior = allowed('junior');
    expect(slopedTurns.filter((piece) => junior.has(piece.id))).toHaveLength(0);
  });

  it('draws Wild Mouse on timber track whose art also covers its steep pieces', () => {
    expect(trackArt('mouse')).toBe('wood');
    expect(trackArt('junior')).toBe('junior');
    const wood = artPieces('wood').map((piece) => piece.name);
    expect(wood).toContain('up60');
    expect(wood).toContain('largeHelixLeftUp');
    expect(wood).not.toContain('verticalLoopLeft');
  });
});

describe('track variants', () => {
  it('shows chain, brake and block-brake art only on pieces that accept the mode', () => {
    const flat = pieceByName('flat')!;
    expect(trackVariant(flat, PieceMode.Normal)).toBe('');
    expect(trackVariant(flat, PieceMode.ChainLift)).toBe('+chain');
    expect(trackVariant(flat, PieceMode.Brake)).toBe('+brake');
    expect(trackVariant(flat, PieceMode.BlockBrake)).toBe('+block');
    const turn = pieceByName('smallLeft')!;
    expect(trackVariant(turn, PieceMode.ChainLift)).toBe('');
    expect(trackVariant(turn, PieceMode.Brake)).toBe('');
  });

  it('keys each footprint cell by the combined piece direction and camera view', () => {
    const piece = pieceByName('smallRight')!;
    const cells = trackCellSprites(piece.id, 1, 2, 'junior', PieceMode.Normal, 0);
    expect(cells).toHaveLength(piece.footprint.length);
    expect(cells[0].key).toBe('rides/coaster/junior/track/smallRight/view-3/cell-0');
    const cell = piece.footprint[1];
    expect([cells[1].dx, cells[1].dy]).toEqual([-cell.j, cell.i]);
  });

  it('animates chain pieces over the chain frames', () => {
    const flat = pieceByName('flat')!;
    const keys = new Set<string>();
    for (let tick = 0; tick < 64; tick++)
      keys.add(trackCellSprites(flat.id, 0, 0, 'wood', PieceMode.ChainLift, tick)[0].key);
    expect(keys.size).toBe(CHAIN_FRAMES);
    expect([...keys][0]).toMatch(/^rides\/coaster\/wood\/track\/flat\+chain\/view-0\/cell-0#\d$/);
  });
});

describe('cars', () => {
  it('turns the heading with the camera, two octants per quarter turn', () => {
    expect(carSpriteKey('wood', 1, 0, 0, 0)).toBe(
      'rides/coaster/wood/vehicles/car/flat/level/heading-1',
    );
    expect(carSpriteKey('wood', 1, 0, 0, 1)).toBe(
      'rides/coaster/wood/vehicles/car/flat/level/heading-3',
    );
    expect(carSpriteKey('wood', 7, 0, 0, 1)).toBe(
      'rides/coaster/wood/vehicles/car/flat/level/heading-1',
    );
  });

  it('names pitch and bank classes', () => {
    expect(carSpriteKey('steel', 0, -2, 1, 0)).toBe(
      'rides/coaster/steel/vehicles/car/down60/left/heading-0',
    );
    expect(carSpriteKey('steel', 0, 3, 3, 0)).toBe(
      'rides/coaster/steel/vehicles/car/up90/inverted/heading-0',
    );
  });

  it('selects water boat sprites from each car passenger count', () => {
    expect(carSpriteKey('log-flume', 0, 0, 0, 0)).toBe(
      'rides/water/log-flume/vehicles/car/flat/heading-0/passengers-0',
    );
    expect(carSpriteKey('river-rapids', 0, 0, 0, 0, 2)).toBe(
      'rides/water/river-rapids/vehicles/car/flat/heading-0/passengers-2',
    );
  });
});

describe('supports', () => {
  it('stops support columns below the track with a quarter-level cap', () => {
    const flat = pieceByName('flat')!;
    expect(supportStack(flat.id, 0, 2, 5)).toEqual({ full: 2, quarters: 3 });
    expect(supportStack(flat.id, 0, 2, 2)).toEqual({ full: 0, quarters: 0 });
    const up = pieceByName('up25')!;
    const stack = supportStack(up.id, 0, 0, 3);
    expect(stack.full + stack.quarters / 4).toBeGreaterThan(2.5);
  });
});
