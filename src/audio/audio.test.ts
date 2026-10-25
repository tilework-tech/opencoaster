import { describe, expect, it } from 'vitest';
import { AudioEngine, crowdLevel, rideMusicGain, soundLevels } from './audio';
import { DEFAULT_SETTINGS } from '../ui/settings';
import { createSnapshot } from '../worker/snapshot';

class RecordingParam {
  value = 0;
  setValueAtTime(value: number): void {
    this.value = value;
  }
  setTargetAtTime(value: number): void {
    this.value = value;
  }
  exponentialRampToValueAtTime(value: number): void {
    this.value = value;
  }
}

class RecordingNode {
  gain = new RecordingParam();
  pan = new RecordingParam();
  frequency = new RecordingParam();
  type = 'sine';
  loop = false;
  buffer: unknown;
  onended: (() => void) | null = null;
  connect(): void {}
  disconnect(): void {}
  start(): void {
    RecordingContext.started++;
  }
  stop(): void {}
}

class RecordingContext {
  static started = 0;
  currentTime = 0;
  sampleRate = 16;
  state = 'suspended';
  destination = new RecordingNode() as unknown as AudioDestinationNode;
  createGain(): GainNode {
    return new RecordingNode() as unknown as GainNode;
  }
  createStereoPanner(): StereoPannerNode {
    return new RecordingNode() as unknown as StereoPannerNode;
  }
  createOscillator(): OscillatorNode {
    return new RecordingNode() as unknown as OscillatorNode;
  }
  createBuffer(_channels: number, length: number): AudioBuffer {
    return { getChannelData: () => new Float32Array(length) } as unknown as AudioBuffer;
  }
  createBufferSource(): AudioBufferSourceNode {
    return new RecordingNode() as unknown as AudioBufferSourceNode;
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
  async close(): Promise<void> {
    this.state = 'closed';
  }
}

describe('audio level controls', () => {
  it('scales park ambience with the number of guests in the snapshot', () => {
    expect(crowdLevel(0)).toBe(0);
    expect(crowdLevel(80)).toBeGreaterThan(crowdLevel(8));
    expect(crowdLevel(10_000)).toBeLessThanOrEqual(1);
  });

  it('attenuates positional ride music toward the edge of the view', () => {
    expect(rideMusicGain(0.5)).toBeGreaterThan(rideMusicGain(1));
    expect(rideMusicGain(1.5)).toBe(0);
  });

  it('applies mute without changing the saved source levels', () => {
    expect(soundLevels({ soundVolume: 0.5, musicVolume: 0.8, muted: true })).toEqual({
      sound: 0,
      music: 0,
    });
    expect(soundLevels({ soundVolume: 0.5, musicVolume: 0.8, muted: false })).toEqual({
      sound: 0.5,
      music: 0.8,
    });
  });

  it('starts no audio before a gesture and consumes snapshot cues after unlock', async () => {
    RecordingContext.started = 0;
    const engine = new AudioEngine(
      DEFAULT_SETTINGS,
      () => new RecordingContext() as unknown as AudioContext,
    );
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });
    engine.update(
      snapshot,
      { width: 800, height: 600, mapWidth: 8, mapHeight: 8 },
      { x: 0, y: 0, zoom: 1, rotation: 0 },
    );
    expect(RecordingContext.started).toBe(0);
    await engine.unlock();
    const ambienceSources = RecordingContext.started;
    snapshot.tick = 1;
    snapshot.audioEvents = [{ id: 1, type: 'build' }];
    engine.update(
      snapshot,
      { width: 800, height: 600, mapWidth: 8, mapHeight: 8 },
      { x: 0, y: 0, zoom: 1, rotation: 0 },
    );
    expect(RecordingContext.started).toBe(ambienceSources + 1);
    snapshot.tick = 2;
    engine.update(
      snapshot,
      { width: 800, height: 600, mapWidth: 8, mapHeight: 8 },
      { x: 0, y: 0, zoom: 1, rotation: 0 },
    );
    expect(RecordingContext.started).toBe(ambienceSources + 1);
    engine.dispose();
  });
});
