import { describe, expect, it } from 'vitest';
import {
  musicLoopLength,
  renderCrowdMurmur,
  renderMusicLoop,
  renderRain,
  rideMusicStyle,
} from './synth';

const RATE = 16_000;

/** Power of one frequency component, via the Goertzel algorithm. */
function tonePower(samples: Float32Array, frequency: number, sampleRate: number): number {
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  for (const x of samples) {
    const s = x + coefficient * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return s1 * s1 + s2 * s2 - coefficient * s1 * s2;
}

function meanPower(samples: Float32Array, frequencies: number[]): number {
  return frequencies.reduce((sum, f) => sum + tonePower(samples, f, RATE), 0) / frequencies.length;
}

/** A loop repeats seamlessly when the step from its last sample to its first is no bigger than any step inside it. */
function seamStep(loop: Float32Array): { seam: number; largestInside: number } {
  let largestInside = 0;
  for (let i = 1; i < loop.length; i++) {
    largestInside = Math.max(largestInside, Math.abs(loop[i]! - loop[i - 1]!));
  }
  return { seam: Math.abs(loop[0]! - loop[loop.length - 1]!), largestInside };
}

describe('crowd murmur and rain beds', () => {
  it('loops without a click at the seam', () => {
    const { seam, largestInside } = seamStep(renderCrowdMurmur(RATE));
    expect(seam).toBeLessThanOrEqual(largestInside);
    const rain = seamStep(renderRain(RATE));
    expect(rain.seam).toBeLessThanOrEqual(rain.largestInside);
  });

  it('keeps the crowd murmur in the voice band, far below the treble', () => {
    const murmur = renderCrowdMurmur(RATE);
    const voice = meanPower(murmur, [300, 500, 800]);
    const treble = meanPower(murmur, [4000, 6000, 7000]);
    expect(10 * Math.log10(voice / treble)).toBeGreaterThan(20);
  });

  it('keeps rain in the upper mids rather than the low end', () => {
    const rain = renderRain(RATE);
    const hiss = meanPower(rain, [2000, 3000, 4000]);
    const rumble = meanPower(rain, [100, 200, 300]);
    expect(10 * Math.log10(hiss / rumble)).toBeGreaterThan(20);
  });

  it('is deterministic and peak-limited', () => {
    const first = renderCrowdMurmur(RATE);
    const second = renderCrowdMurmur(RATE);
    expect(second).toEqual(first);
    expect(Math.max(...first.map(Math.abs))).toBeCloseTo(0.5, 5);
  });
});

describe('ride and park music loops', () => {
  it('renders each loop for a whole number of bars', () => {
    expect(renderMusicLoop('upbeat', RATE)).toHaveLength(musicLoopLength('upbeat', RATE));
    expect(renderMusicLoop('organ', RATE)).toHaveLength(musicLoopLength('organ', RATE));
    expect(renderMusicLoop('park', RATE)).toHaveLength(musicLoopLength('park', RATE));
    expect(musicLoopLength('upbeat', 44_100)).toBe(Math.round(4 * 4 * (60 / 150) * 44_100));
  });

  it('loops every style without a click at the seam', () => {
    for (const style of ['organ', 'upbeat', 'park'] as const) {
      const { seam, largestInside } = seamStep(renderMusicLoop(style, RATE));
      expect(seam, style).toBeLessThanOrEqual(largestInside);
    }
  });

  it('plays audible music rather than silence', () => {
    for (const style of ['organ', 'upbeat', 'park'] as const) {
      const loop = renderMusicLoop(style, RATE);
      const rms = Math.sqrt(loop.reduce((sum, x) => sum + x * x, 0) / loop.length);
      expect(rms, style).toBeGreaterThan(0.05);
    }
  });

  it('gives gentle rides the organ and thrill rides the upbeat loop', () => {
    expect(rideMusicStyle('gentle')).toBe('organ');
    expect(rideMusicStyle('transport')).toBe('organ');
    expect(rideMusicStyle('thrill')).toBe('upbeat');
    expect(rideMusicStyle('coaster')).toBe('upbeat');
    expect(rideMusicStyle(undefined)).toBe('upbeat');
  });
});
