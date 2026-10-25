import { performance } from 'node:perf_hooks';
import { AudioEngine } from '../src/audio/audio';
import { createSnapshot, RideInfo, RIDE_INFO_STRIDE } from '../src/worker/snapshot';
import { RidePhase, RideState } from '../src/sim/rides/ride-store';
import { nearestRankPercentile } from './stats';

class Param {
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

class Node {
  gain = new Param();
  pan = new Param();
  frequency = new Param();
  connect(): void {}
  disconnect(): void {}
  start(): void {}
  stop(): void {}
  type = 'sine';
  loop = false;
  buffer: unknown;
  onended: (() => void) | null = null;
}

class FakeContext {
  currentTime = 1;
  sampleRate = 32;
  state = 'running';
  destination = new Node() as unknown as AudioDestinationNode;
  createGain(): GainNode {
    return new Node() as unknown as GainNode;
  }
  createStereoPanner(): StereoPannerNode {
    return new Node() as unknown as StereoPannerNode;
  }
  createOscillator(): OscillatorNode {
    return new Node() as unknown as OscillatorNode;
  }
  createBuffer(_channels: number, length: number): AudioBuffer {
    return { getChannelData: () => new Float32Array(length) } as unknown as AudioBuffer;
  }
  createBufferSource(): AudioBufferSourceNode {
    return new Node() as unknown as AudioBufferSourceNode;
  }
  async resume(): Promise<void> {}
  async close(): Promise<void> {}
}

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const iterations = Number(process.env.AUDIO_BENCH_TICKS ?? 2000);
const rides = Number(process.env.AUDIO_BENCH_RIDES ?? 128);
const snapshot = createSnapshot({
  guests: 5000,
  staff: 0,
  vehicles: 0,
  litter: 0,
  rides,
  mapTiles: 256 * 256,
});
snapshot.tick = 1;
snapshot.guests.count = 2200;
snapshot.rides.count = rides;
for (let i = 0; i < rides; i++) {
  const offset = i * RIDE_INFO_STRIDE;
  snapshot.rideInfo[offset + RideInfo.Id] = i + 1;
  snapshot.rideInfo[offset + RideInfo.State] = RideState.Open;
  snapshot.rideInfo[offset + RideInfo.Phase] = RidePhase.Running;
  snapshot.rideInfo[offset + RideInfo.RideX] = (i % 32) + 96;
  snapshot.rideInfo[offset + RideInfo.RideY] = (Math.floor(i / 32) % 32) + 96;
}
const camera = { x: 0, y: 3200, zoom: 1, rotation: 0 as const };
const audio = new AudioEngine(
  { speed: 1, paused: false, soundVolume: 1, musicVolume: 0.7, muted: false },
  () => new FakeContext() as unknown as AudioContext,
);
await audio.unlock();
for (let i = 0; i < 100; i++) {
  snapshot.tick++;
  audio.update(snapshot, { width: 1280, height: 800, mapWidth: 256, mapHeight: 256 }, camera);
}
const samples = new Array<number>(iterations);
for (let i = 0; i < iterations; i++) {
  snapshot.tick++;
  const start = performance.now();
  audio.update(snapshot, { width: 1280, height: 800, mapWidth: 256, mapHeight: 256 }, camera);
  samples[i] = performance.now() - start;
}
audio.dispose();
const p50 = nearestRankPercentile(samples, 0.5);
const p95 = nearestRankPercentile(samples, 0.95);
const p99 = nearestRankPercentile(samples, 0.99);
console.log(
  `audio update: ${iterations} frames, ${rides} rides; p50 ${p50.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms`,
);
console.log(`target p99 < 0.5 ms: ${p99 < 0.5 ? 'PASS' : 'FAIL'}`);
if (strict && p99 >= 0.5) process.exitCode = 1;
