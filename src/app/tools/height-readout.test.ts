import { describe, expect, it } from 'vitest';
import { heightReadoutText } from './height-readout';
import type { ReadoutMap } from './height-readout';

function map(): ReadoutMap {
  const heights = new Uint8Array(16).fill(4);
  const slope = new Uint8Array(16);
  heights[5] = 6;
  slope[6] = 0b0011;
  return { width: 4, heights, slope, waterLevel: new Uint8Array(16) };
}

describe('heightReadoutText', () => {
  it('reads the base height of a flat tile', () => {
    expect(heightReadoutText(map(), [0, 0], { tool: 'select', rotation: 0 })).toBe('Height 4');
  });

  it('adds corner heights, in view order, for a sloped tile', () => {
    const m = map();
    expect(heightReadoutText(m, [2, 1], { tool: 'select', rotation: 0 })).toBe(
      'Height 4 · corners 5/5/4/4',
    );
    expect(heightReadoutText(m, [2, 1], { tool: 'select', rotation: 1 })).toBe(
      'Height 4 · corners 4/5/5/4',
    );
  });

  it('reports the water level of a flooded tile', () => {
    const m = map();
    m.waterLevel![0] = 6;
    expect(heightReadoutText(m, [0, 0], { tool: 'select', rotation: 0 })).toBe(
      'Height 4 · water 6',
    );
  });

  it('shows the height the land tool would reach', () => {
    const m = map();
    expect(heightReadoutText(m, [1, 1], { tool: 'land', rotation: 0, landMode: 'raise' })).toBe(
      'Height 6 · raise to 7',
    );
    expect(heightReadoutText(m, [0, 0], { tool: 'land', rotation: 0, landMode: 'lower' })).toBe(
      'Height 4 · lower to 3',
    );
    expect(
      heightReadoutText(m, [2, 1], { tool: 'land', rotation: 0, landMode: 'raise' }),
    ).toContain('raise to 6');
  });

  it('shows the water level the water tool would set', () => {
    const m = map();
    expect(heightReadoutText(m, [0, 0], { tool: 'water', rotation: 0 })).toBe(
      'Height 4 · water to 5',
    );
    m.waterLevel![0] = 6;
    expect(heightReadoutText(m, [0, 0], { tool: 'water', rotation: 0, waterLower: true })).toBe(
      'Height 4 · water 6 · water to 5',
    );
  });

  it('shows the height paths and track would be built at', () => {
    const m = map();
    expect(heightReadoutText(m, [1, 1], { tool: 'path', rotation: 0 })).toBe(
      'Height 6 · path at 6',
    );
    expect(heightReadoutText(m, [1, 1], { tool: 'track', rotation: 0, trackLevel: 9 })).toBe(
      'Height 6 · track at 9',
    );
  });
});
