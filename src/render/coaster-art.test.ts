import { describe, expect, it } from 'vitest';
import { pieceByName } from '../sim/track/catalog';
import { PieceMode } from '../sim/track/track-types';
import { RideType } from '../sim/rides/ride-types';
import {
  CHAIN_FRAMES,
  carSpriteKey,
  coasterFamily,
  supportStack,
  trackCellSprites,
  trackVariant,
} from './coaster-art';

describe('coaster families', () => {
  it('maps each coaster ride type to its own art family', () => {
    expect(coasterFamily(RideType.WoodenCoaster)).toBe('wood');
    expect(coasterFamily(RideType.SteelLoopingCoaster)).toBe('steel');
    expect(coasterFamily(RideType.JuniorRollerCoaster)).toBe('junior');
    expect(coasterFamily(RideType.WildMouseCoaster)).toBe('mouse');
    expect(coasterFamily(RideType.MerryGoRound)).toBeUndefined();
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
    expect(cells[0].key).toBe('track/steel/smallRight/view-3/cell-0');
    const cell = piece.footprint[1];
    expect([cells[1].dx, cells[1].dy]).toEqual([-cell.j, cell.i]);
  });

  it('animates chain pieces over the chain frames', () => {
    const flat = pieceByName('flat')!;
    const keys = new Set<string>();
    for (let tick = 0; tick < 64; tick++)
      keys.add(trackCellSprites(flat.id, 0, 0, 'wood', PieceMode.ChainLift, tick)[0].key);
    expect(keys.size).toBe(CHAIN_FRAMES);
    expect([...keys][0]).toMatch(/^track\/wood\/flat\+chain\/view-0\/cell-0#\d$/);
  });
});

describe('cars', () => {
  it('turns the heading with the camera, two octants per quarter turn', () => {
    expect(carSpriteKey('wood', 1, 0, 0, 0)).toBe('vehicles/wood/car/flat/level/heading-1');
    expect(carSpriteKey('wood', 1, 0, 0, 1)).toBe('vehicles/wood/car/flat/level/heading-3');
    expect(carSpriteKey('wood', 7, 0, 0, 1)).toBe('vehicles/wood/car/flat/level/heading-1');
  });

  it('names pitch and bank classes', () => {
    expect(carSpriteKey('steel', 0, -2, 1, 0)).toBe('vehicles/steel/car/down60/left/heading-0');
    expect(carSpriteKey('steel', 0, 3, 3, 0)).toBe('vehicles/steel/car/up90/inverted/heading-0');
  });
});

describe('supports', () => {
  it('stacks whole levels from the ground and tops them with quarter-level pieces', () => {
    const flat = pieceByName('flat')!;
    expect(supportStack(flat.id, 0, 2, 5)).toEqual({ full: 3, quarters: 0 });
    expect(supportStack(flat.id, 0, 2, 2)).toEqual({ full: 0, quarters: 0 });
    const up = pieceByName('up25')!;
    const stack = supportStack(up.id, 0, 0, 3);
    expect(stack.full + stack.quarters / 4).toBeGreaterThan(2.5);
  });
});
