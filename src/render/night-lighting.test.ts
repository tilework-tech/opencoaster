import { describe, expect, it } from 'vitest';
import { PATH_ADDITION_BROKEN, PathFlag } from '../sim/map/tile-map';
import {
  LAMP_ON_DARKNESS,
  TICKS_PER_NIGHT_CYCLE,
  LampLightBuffer,
  ambientTint,
  collectLitLamps,
  darknessAt,
  lampsLit,
} from './night-lighting';
import type { Camera, MapData } from './renderer';

/** Tick at a fraction of one lighting cycle. */
function tickAtCycleFraction(fraction: number): number {
  return Math.round(fraction * TICKS_PER_NIGHT_CYCLE);
}
const MORNING = 0;
const NOON = tickAtCycleFraction(4 / 24);
const DUSK = tickAtCycleFraction(11 / 24);
const MIDNIGHT = tickAtCycleFraction(16 / 24);

function lampMap(lamps: Array<{ x: number; y: number; data: number }>): MapData {
  const size = 16;
  const pathElements = new Int32Array(lamps.length * 6);
  lamps.forEach((lamp, i) => {
    pathElements.set([lamp.x, lamp.y, 4, PathFlag.Lamp | 0x05, lamp.data, 0], i * 6);
  });
  return {
    width: size,
    height: size,
    heights: new Uint8Array(size * size).fill(4),
    surface: new Uint8Array(size * size),
    slope: new Uint8Array(size * size),
    pathElements,
    pathCount: lamps.length,
  };
}

const camera: Camera = { x: 0, y: 256, zoom: 1, rotation: 0 };

describe('darkness', () => {
  it('keeps full-night ambient light above a readable minimum while retaining a cool tint', () => {
    const [red, green, blue] = ambientTint(1);
    expect(red).toBeGreaterThanOrEqual(150);
    expect(green).toBeGreaterThanOrEqual(160);
    expect(blue).toBeGreaterThanOrEqual(200);
    expect(blue).toBeGreaterThan(red);
  });

  it('is zero at noon and full at midnight, repeating after the longer in-game cycle', () => {
    expect(darknessAt(NOON)).toBe(0);
    expect(darknessAt(MORNING)).toBe(0);
    expect(darknessAt(MIDNIGHT)).toBe(1);
    expect(darknessAt(MIDNIGHT + TICKS_PER_NIGHT_CYCLE)).toBeCloseTo(darknessAt(MIDNIGHT), 1);
    expect(TICKS_PER_NIGHT_CYCLE / 40).toBeGreaterThanOrEqual(6 * 60);
    expect(TICKS_PER_NIGHT_CYCLE / 40).toBeLessThanOrEqual(10 * 60);
    expect(TICKS_PER_NIGHT_CYCLE / 12 / 40).toBeGreaterThanOrEqual(20);
  });

  it('rises through dusk and falls through dawn without reversing', () => {
    const dusk = [];
    for (let f = 9 / 24; f <= 13 / 24; f += 0.002) dusk.push(darknessAt(tickAtCycleFraction(f)));
    for (let i = 1; i < dusk.length; i++) expect(dusk[i]!).toBeGreaterThanOrEqual(dusk[i - 1]!);
    expect(darknessAt(DUSK)).toBeGreaterThan(0);
    expect(darknessAt(DUSK)).toBeLessThan(1);
  });
});

describe('lamp switching', () => {
  it('switches on at the threshold and off below it', () => {
    expect(lampsLit(LAMP_ON_DARKNESS)).toBe(true);
    expect(lampsLit(LAMP_ON_DARKNESS - 0.01)).toBe(false);
    expect(lampsLit(darknessAt(NOON))).toBe(false);
    expect(lampsLit(darknessAt(MIDNIGHT))).toBe(true);
  });

  it('changes state once at dusk and once at dawn, never flickering in between', () => {
    let changes = 0;
    let previous = lampsLit(darknessAt(0));
    for (let tick = 1; tick < TICKS_PER_NIGHT_CYCLE; tick++) {
      const lit = lampsLit(darknessAt(tick));
      if (lit !== previous) changes++;
      previous = lit;
    }
    expect(changes).toBe(2);
  });
});

describe('lit lamps', () => {
  it('lists every intact lamp in view with a position', () => {
    const lights = new LampLightBuffer();
    const map = lampMap([
      { x: 7, y: 7, data: 0 },
      { x: 8, y: 7, data: 0 },
    ]);
    expect(collectLitLamps(map, camera, 800, 600, lights)).toBeGreaterThanOrEqual(2);
  });

  it('leaves broken lamps dark', () => {
    const lights = new LampLightBuffer();
    const intact = collectLitLamps(lampMap([{ x: 7, y: 7, data: 0 }]), camera, 800, 600, lights);
    const broken = collectLitLamps(
      lampMap([{ x: 7, y: 7, data: PATH_ADDITION_BROKEN }]),
      camera,
      800,
      600,
      lights,
    );
    expect(intact).toBeGreaterThan(0);
    expect(broken).toBe(0);
  });

  it('skips lamps far outside the view', () => {
    const lights = new LampLightBuffer();
    const far: Camera = { ...camera, x: 100000 };
    expect(collectLitLamps(lampMap([{ x: 7, y: 7, data: 0 }]), far, 800, 600, lights)).toBe(0);
  });
});
