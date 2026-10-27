import { describe, expect, it } from 'vitest';
import { decodeHeight, encodeHeight, HEIGHT_RESOLUTION } from './height-encoding';

describe('height encoding', () => {
  it('round-trips heights within half a step across the supported range', () => {
    for (const h of [-100, -1.5, -0.01, 0, 0.004, 1 / 16, 3.75, 40.2, 120]) {
      const [hi, lo] = encodeHeight(h);
      expect(hi).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThan(256);
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(lo).toBeLessThan(256);
      expect(Math.abs(decodeHeight(hi, lo) - h)).toBeLessThanOrEqual(0.5 / HEIGHT_RESOLUTION);
    }
  });

  it('preserves order between heights one pixel row apart', () => {
    const [a0, a1] = encodeHeight(2);
    const [b0, b1] = encodeHeight(2 + 1 / 16);
    expect(decodeHeight(b0, b1)).toBeGreaterThan(decodeHeight(a0, a1));
  });
});
