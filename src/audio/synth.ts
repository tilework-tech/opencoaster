import type { RideCategory } from '../sim/rides/ride-types';

/** Original, procedurally generated audio. Pure functions: no Web Audio, no randomness outside the seed. */

export type MusicStyle = 'organ' | 'upbeat' | 'park';
export type RideMusicStyle = Exclude<MusicStyle, 'park'>;

type Voice = 'reed' | 'pad' | 'lead' | 'bass' | 'pluck' | 'kick' | 'hat';

interface Note {
  beat: number;
  beats: number;
  midi: number;
  voice: Voice;
  level: number;
}

interface LoopSpec {
  tempo: number;
  beatsPerBar: number;
  bars: number;
  /** Notes for the whole loop, with `beat` counted from the loop start. */
  notes: () => Note[];
}

const ATTACK_SECONDS: Record<Voice, number> = {
  reed: 0.01,
  pad: 0.05,
  lead: 0.01,
  bass: 0.005,
  pluck: 0.002,
  kick: 0.001,
  hat: 0.001,
};

const RELEASE_SECONDS: Record<Voice, number> = {
  reed: 0.05,
  pad: 0.25,
  lead: 0.12,
  bass: 0.08,
  pluck: 0.25,
  kick: 0.25,
  hat: 0.04,
};

/** Peak level of every rendered loop, so the engine's gains alone set the mix. */
const LOOP_PEAK = 0.5;

/** Deterministic xorshift32 generator returning values in [0, 1). */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

function midiFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ cookbook biquad. Frequencies are clamped below Nyquist so tiny test rates stay finite. */
function biquad(type: 'lowpass' | 'highpass', frequency: number, sampleRate: number): Biquad {
  const f = Math.min(frequency, sampleRate * 0.45);
  const w = (2 * Math.PI * f) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b0 = type === 'lowpass' ? (1 - cos) / 2 : (1 + cos) / 2;
  const b1 = type === 'lowpass' ? 1 - cos : -(1 + cos);
  return { b0: b0 / a0, b1: b1 / a0, b2: b0 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

function filter(signal: Float64Array, c: Biquad): void {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const x = signal[i]!;
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    signal[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
}

function normalize(signal: Float32Array, peak: number): Float32Array {
  let max = 0;
  for (let i = 0; i < signal.length; i++) max = Math.max(max, Math.abs(signal[i]!));
  const scale = max > 0 ? peak / max : 0;
  for (let i = 0; i < signal.length; i++) signal[i] = signal[i]! * scale;
  return signal;
}

/**
 * Turns `loop + crossfade` samples into a buffer whose last sample flows into its first.
 * The first `crossfade` samples blend toward the continuation past the end of the loop.
 */
function seamlessLoop(signal: Float64Array, length: number): Float32Array {
  const crossfade = signal.length - length;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    if (i >= crossfade) {
      out[i] = signal[i]!;
      continue;
    }
    const w = i / crossfade;
    out[i] = w * signal[i]! + (1 - w) * signal[i + length]!;
  }
  return out;
}

/**
 * Band-limited noise bed. The band is the only spectral shaping: no hiss above the band.
 * `swell` adds slow level movement with an integer number of cycles per loop, so it repeats exactly.
 */
function bandNoise(
  sampleRate: number,
  seconds: number,
  seed: number,
  band: { low: number; high: number },
  swell: boolean,
): Float32Array {
  const length = Math.round(sampleRate * seconds);
  const crossfade = Math.round(sampleRate * 0.5);
  const rng = makeRng(seed);
  const signal = new Float64Array(length + crossfade);
  for (let i = 0; i < signal.length; i++) signal[i] = rng() * 2 - 1;
  filter(signal, biquad('lowpass', band.high, sampleRate));
  filter(signal, biquad('lowpass', band.high, sampleRate));
  filter(signal, biquad('highpass', band.low, sampleRate));
  if (swell) {
    for (let i = 0; i < signal.length; i++) {
      const phase = i / length;
      signal[i] *=
        1 + 0.3 * Math.sin(2 * Math.PI * 3 * phase) + 0.2 * Math.sin(2 * Math.PI * 5 * phase + 1.3);
    }
  }
  return normalize(seamlessLoop(signal, length), LOOP_PEAK);
}

/** Soft, low-passed crowd murmur that swells slowly. Quiet by design; the engine scales it by crowd size. */
export function renderCrowdMurmur(sampleRate: number): Float32Array {
  return bandNoise(sampleRate, 6, 7, { low: 180, high: 1200 }, true);
}

/** Rain hiss kept in the upper mids so it does not read as broadband static. */
export function renderRain(sampleRate: number): Float32Array {
  return bandNoise(sampleRate, 4, 11, { low: 1500, high: 6000 }, false);
}

function mixNote(
  out: Float64Array,
  sampleRate: number,
  beatSeconds: number,
  note: Note,
  rng: () => number,
): void {
  const start = Math.round(note.beat * beatSeconds * sampleRate);
  const length = Math.round(note.beats * beatSeconds * sampleRate);
  const tail = Math.round(RELEASE_SECONDS[note.voice] * sampleRate);
  const attack = Math.max(1, Math.round(ATTACK_SECONDS[note.voice] * sampleRate));
  const w = (2 * Math.PI * midiFrequency(note.midi)) / sampleRate;
  let hatState = 0;
  for (let i = 0; i < length + tail; i++) {
    const t = i / sampleRate;
    let env = Math.min(1, i / attack);
    if (i >= length) env *= Math.max(0, 1 - (i - length) / tail);
    const ph = w * i;
    let sample: number;
    switch (note.voice) {
      case 'reed':
        sample =
          (Math.sin(ph) + Math.sin(3 * ph) / 3 + Math.sin(5 * ph) / 5 + Math.sin(7 * ph) / 7) * 0.5;
        break;
      case 'pad':
        sample = (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph)) / 1.75;
        break;
      case 'lead':
        sample = (2 / Math.PI) * Math.asin(Math.sin(ph));
        break;
      case 'bass':
        sample =
          (Math.sin(ph) + Math.sin(2 * ph) / 2 + Math.sin(3 * ph) / 3 + Math.sin(4 * ph) / 4) * 0.5;
        break;
      case 'pluck':
        sample = (Math.sin(ph) + Math.sin(3 * ph) / 3) * Math.exp(-9 * t);
        break;
      case 'kick': {
        const phase = 2 * Math.PI * (45 * t + (75 * (1 - Math.exp(-25 * t))) / 25);
        sample = Math.sin(phase) * Math.exp(-18 * t);
        break;
      }
      case 'hat': {
        const noise = rng() * 2 - 1;
        sample = (noise - hatState) * Math.exp(-70 * t);
        hatState = noise;
        break;
      }
    }
    out[(start + i) % out.length]! += sample * env * note.level;
  }
}

// Park theme: C major, I–vi–IV–V over eight bars.
const PARK_CHORDS: readonly (readonly number[])[] = [
  [48, 52, 55],
  [45, 48, 52],
  [41, 45, 48],
  [43, 47, 50],
];
const PARK_PROGRESSION = [0, 1, 2, 3, 0, 1, 2, 3];
const PARK_MELODY: readonly (readonly [beat: number, beats: number, midi: number])[][] = [
  [
    [0, 1, 76],
    [1, 1, 79],
    [2, 2, 84],
  ],
  [
    [0, 1, 74],
    [1, 1, 72],
    [2, 2, 69],
  ],
  [
    [0, 1, 77],
    [1, 1, 81],
    [2, 2, 79],
  ],
  [
    [0, 1, 71],
    [1, 1, 74],
    [2, 2, 67],
  ],
  [
    [0, 1, 76],
    [1, 1, 79],
    [2, 1, 84],
    [3, 1, 83],
  ],
  [
    [0, 2, 81],
    [2, 2, 76],
  ],
  [
    [0, 1, 69],
    [1, 1, 72],
    [2, 2, 77],
  ],
  [
    [0, 1, 76],
    [1, 1, 74],
    [2, 1, 71],
    [3, 1, 67],
  ],
];

function parkNotes(): Note[] {
  const notes: Note[] = [];
  PARK_PROGRESSION.forEach((chord, bar) => {
    const at = bar * 4;
    for (const midi of PARK_CHORDS[chord]!) {
      notes.push({ beat: at, beats: 4, midi, voice: 'pad', level: 0.18 });
    }
    notes.push({
      beat: at,
      beats: 1.5,
      midi: PARK_CHORDS[chord]![0]! - 12,
      voice: 'bass',
      level: 0.35,
    });
    notes.push({
      beat: at + 2,
      beats: 1.5,
      midi: PARK_CHORDS[chord]![0]! - 12,
      voice: 'bass',
      level: 0.3,
    });
    for (const [beat, beats, midi] of PARK_MELODY[bar]!) {
      notes.push({ beat: at + beat, beats, midi, voice: 'lead', level: 0.45 });
    }
  });
  return notes;
}

// Fairground organ: G major, 3/4 oom-pah-pah with reed melody.
const ORGAN_CHORDS: readonly (readonly number[])[] = [
  [55, 59, 62],
  [48, 52, 55],
  [50, 54, 57],
  [55, 59, 62],
];
const ORGAN_MELODY: readonly (readonly [beat: number, beats: number, midi: number])[][] = [
  [
    [0, 1, 74],
    [1, 1, 71],
    [2, 1, 67],
  ],
  [
    [0, 1, 76],
    [1, 1, 72],
    [2, 1, 67],
  ],
  [
    [0, 1, 78],
    [1, 1, 74],
    [2, 1, 69],
  ],
  [
    [0, 1, 67],
    [1, 1, 71],
    [2, 1, 74],
  ],
];

function organNotes(): Note[] {
  const notes: Note[] = [];
  ORGAN_CHORDS.forEach((chord, bar) => {
    const at = bar * 3;
    notes.push({ beat: at, beats: 1, midi: chord[0]! - 12, voice: 'bass', level: 0.4 });
    for (const beat of [1, 2]) {
      for (const midi of chord) {
        notes.push({ beat: at + beat, beats: 0.9, midi, voice: 'pad', level: 0.16 });
      }
    }
    for (const [beat, beats, midi] of ORGAN_MELODY[bar]!) {
      notes.push({ beat: at + beat, beats, midi, voice: 'reed', level: 0.22 });
    }
  });
  return notes;
}

// Thrill ride: E minor, four-on-the-floor with an arpeggio and an eighth-note bass.
const UPBEAT_CHORDS: readonly (readonly number[])[] = [
  [52, 55, 59],
  [48, 52, 55],
  [55, 59, 62],
  [50, 54, 57],
];

function upbeatNotes(): Note[] {
  const notes: Note[] = [];
  UPBEAT_CHORDS.forEach((chord, bar) => {
    const at = bar * 4;
    for (let beat = 0; beat < 4; beat++) {
      notes.push({ beat: at + beat, beats: 0.4, midi: 36, voice: 'kick', level: 0.8 });
      notes.push({ beat: at + beat + 0.5, beats: 0.25, midi: 60, voice: 'hat', level: 0.16 });
      notes.push({ beat: at + beat, beats: 0.45, midi: chord[0]! - 12, voice: 'bass', level: 0.3 });
      notes.push({
        beat: at + beat + 0.5,
        beats: 0.45,
        midi: chord[0]!,
        voice: 'bass',
        level: 0.18,
      });
    }
    const arpeggio = [chord[0]!, chord[1]!, chord[2]!, chord[1]!];
    for (let step = 0; step < 8; step++) {
      notes.push({
        beat: at + step * 0.5,
        beats: 0.4,
        midi: arpeggio[step % 4]! + 12,
        voice: 'pluck',
        level: 0.2,
      });
    }
  });
  return notes;
}

const LOOPS: Record<MusicStyle, LoopSpec> = {
  park: { tempo: 100, beatsPerBar: 4, bars: 8, notes: parkNotes },
  organ: { tempo: 120, beatsPerBar: 3, bars: 4, notes: organNotes },
  upbeat: { tempo: 150, beatsPerBar: 4, bars: 4, notes: upbeatNotes },
};

/** Length in samples of a music loop at the given rate. */
export function musicLoopLength(style: MusicStyle, sampleRate: number): number {
  const spec = LOOPS[style];
  return Math.round(spec.bars * spec.beatsPerBar * (60 / spec.tempo) * sampleRate);
}

/** Renders one seamless, peak-normalized loop of the given style. */
export function renderMusicLoop(style: MusicStyle, sampleRate: number): Float32Array {
  const spec = LOOPS[style];
  const beatSeconds = 60 / spec.tempo;
  const length = musicLoopLength(style, sampleRate);
  const out = new Float64Array(length);
  const rng = makeRng(1);
  for (const note of spec.notes()) mixNote(out, sampleRate, beatSeconds, note, rng);
  const loop = new Float32Array(length);
  for (let i = 0; i < length; i++) loop[i] = out[i]!;
  return normalize(loop, LOOP_PEAK);
}

/** Gentle rides get the fairground organ; everything else gets the upbeat loop. */
export function rideMusicStyle(category: RideCategory | undefined): RideMusicStyle {
  return category === 'gentle' || category === 'transport' ? 'organ' : 'upbeat';
}
