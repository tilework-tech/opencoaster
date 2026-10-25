import type { PlayerSettings } from '../ui/settings';
import { RideInfo, RIDE_INFO_STRIDE } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import { project } from '../render/projection';
import type { Camera } from '../render/renderer';

export interface AudioLevels {
  sound: number;
  music: number;
}

export function soundLevels(
  settings: Pick<PlayerSettings, 'soundVolume' | 'musicVolume' | 'muted'>,
): AudioLevels {
  return settings.muted
    ? { sound: 0, music: 0 }
    : { sound: settings.soundVolume, music: settings.musicVolume };
}

export function crowdLevel(guests: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, guests) / 500));
}

export function rideMusicGain(distanceFromCenter: number): number {
  return Math.max(0, 1 - Math.max(0, distanceFromCenter - 0.2) / 0.8);
}

type SoundName =
  | 'click'
  | 'open'
  | 'close'
  | 'news'
  | 'register'
  | 'build'
  | 'demolish'
  | 'bell'
  | 'scream'
  | 'clank'
  | 'thunder';

const MELODY = [392, 494, 587, 494, 440, 523, 659, 523];

/** Main-thread, original procedural audio. It never owns or mutates simulation state. */
export class AudioEngine {
  private context: AudioContext | null = null;
  private effects: GainNode | null = null;
  private music: GainNode | null = null;
  private ambience: GainNode | null = null;
  private rain: GainNode | null = null;
  private lastTick = -1;
  private lastWeather = 0;
  private lastAudioEvent = 0;
  private lastRegisterTime = Number.NEGATIVE_INFINITY;
  private lastRideCount = 0;
  private updateFrame = 0;
  private readonly rideStates = new Map<number, number>();
  private readonly pendingUiSounds: Array<'click' | 'open' | 'close' | 'news'> = [];
  private readonly musicVoices = new Map<
    number,
    { gain: GainNode; panner: StereoPannerNode; oscillator: OscillatorNode; visibleFrame: number }
  >();
  private readonly projected = new Float64Array(2);

  constructor(
    private settings: PlayerSettings,
    private readonly createContext = () => new AudioContext(),
  ) {}

  setSettings(settings: PlayerSettings): void {
    this.settings = settings;
    const levels = soundLevels(settings);
    this.effects?.gain.setTargetAtTime(levels.sound, this.context!.currentTime, 0.04);
    this.music?.gain.setTargetAtTime(levels.music, this.context!.currentTime, 0.04);
  }

  reset(): void {
    for (const voice of this.musicVoices.values()) {
      voice.gain.disconnect();
      voice.panner.disconnect();
      voice.oscillator.stop();
    }
    this.musicVoices.clear();
    this.rideStates.clear();
    this.pendingUiSounds.length = 0;
    this.lastTick = -1;
    this.lastWeather = 0;
    this.lastAudioEvent = 0;
    this.lastRegisterTime = Number.NEGATIVE_INFINITY;
    this.lastRideCount = 0;
    this.updateFrame = 0;
  }

  async unlock(): Promise<void> {
    if (!this.context) {
      this.context = this.createContext();
      this.effects = this.context.createGain();
      this.music = this.context.createGain();
      this.ambience = this.context.createGain();
      this.rain = this.context.createGain();
      this.effects.connect(this.context.destination);
      this.music.connect(this.context.destination);
      this.ambience.connect(this.effects);
      this.rain.connect(this.effects);
      this.setSettings(this.settings);
      this.startAmbience();
    }
    if (this.context.state !== 'running') await this.context.resume();
    for (const name of this.pendingUiSounds.splice(0)) this.play(name);
  }

  playUi(name: 'click' | 'open' | 'close' | 'news'): void {
    if (!this.context) return;
    if (this.context.state !== 'running') {
      if (this.pendingUiSounds.length < 8) this.pendingUiSounds.push(name);
      return;
    }
    this.play(name);
  }

  update(
    snapshot: Snapshot,
    viewport: { width: number; height: number; mapWidth: number; mapHeight: number },
    camera: Camera,
  ): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') return;
    this.updateFrame++;
    if (snapshot.tick < this.lastTick) {
      this.lastTick = -1;
      this.lastWeather = 0;
      this.lastAudioEvent = 0;
      this.lastRegisterTime = Number.NEGATIVE_INFINITY;
      this.rideStates.clear();
      this.lastRideCount = 0;
    }
    const now = ctx.currentTime;
    const level = soundLevels(this.settings);
    this.ambience!.gain.setTargetAtTime(crowdLevel(snapshot.guests.count), now, 0.4);
    const raining = snapshot.weather.kind >= 2;
    this.rain!.gain.setTargetAtTime(raining ? 0.16 : 0, now, 0.6);
    if (snapshot.tick !== this.lastTick) {
      if (snapshot.weather.kind === 3 && this.lastWeather !== 3) this.play('thunder');
      for (const event of snapshot.audioEvents) {
        if (event.id <= this.lastAudioEvent) continue;
        if (event.type === 'register') {
          if (now - this.lastRegisterTime < 0.16) {
            this.lastAudioEvent = event.id;
            continue;
          }
          this.lastRegisterTime = now;
        }
        this.play(event.type, Math.min(1, (event.intensity ?? 100) / 100));
        this.lastAudioEvent = event.id;
      }
      this.lastTick = snapshot.tick;
      this.lastWeather = snapshot.weather.kind;
    }
    for (let i = 0; i < snapshot.rides.count; i++) {
      const o = i * RIDE_INFO_STRIDE;
      const id = snapshot.rideInfo[o + RideInfo.Id];
      const phase = snapshot.rideInfo[o + RideInfo.Phase];
      const state = snapshot.rideInfo[o + RideInfo.State];
      const x = snapshot.rideInfo[o + RideInfo.RideX];
      const y = snapshot.rideInfo[o + RideInfo.RideY];
      project(
        x * 256 + 128,
        y * 256 + 128,
        0,
        viewport.mapWidth,
        viewport.mapHeight,
        camera.rotation,
        this.projected,
      );
      const screenX = viewport.width / 2 + (this.projected[0]! - camera.x) * camera.zoom;
      const screenY = viewport.height / 2 + (this.projected[1]! - camera.y) * camera.zoom;
      const dx = (screenX - viewport.width / 2) / Math.max(1, viewport.width / 2);
      const dy = (screenY - viewport.height / 2) / Math.max(1, viewport.height / 2);
      const distance = Math.sqrt(dx * dx + dy * dy);
      const key = (state << 8) | phase;
      if (this.rideStates.get(id) !== undefined && this.rideStates.get(id) !== key) {
        if (phase === 5) this.play('bell');
      }
      this.rideStates.set(id, key);
      if (state === 1 && Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
        this.syncMusic(id, distance, dx, level.music, snapshot.tick);
      }
    }
    if (this.lastRideCount !== snapshot.rides.count) {
      for (const id of this.rideStates.keys()) {
        let found = false;
        for (let i = 0; i < snapshot.rides.count; i++) {
          if (snapshot.rideInfo[i * RIDE_INFO_STRIDE + RideInfo.Id] === id) {
            found = true;
            break;
          }
        }
        if (!found) this.rideStates.delete(id);
      }
      this.lastRideCount = snapshot.rides.count;
    }
    for (const [id, voice] of this.musicVoices) {
      if (voice.visibleFrame !== this.updateFrame) {
        voice.gain.gain.setTargetAtTime(0, now, 0.18);
        voice.gain.disconnect();
        voice.panner.disconnect();
        voice.oscillator.stop();
        this.musicVoices.delete(id);
      }
    }
  }

  dispose(): void {
    for (const voice of this.musicVoices.values()) {
      voice.gain.disconnect();
      voice.panner.disconnect();
      voice.oscillator.stop();
    }
    this.musicVoices.clear();
    void this.context?.close();
    this.context = null;
  }

  private startAmbience(): void {
    const ctx = this.context!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = (Math.random() * 2 - 1) * 0.025;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.ambience!);
    source.start();
    const rainBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const rainData = rainBuffer.getChannelData(0);
    for (let i = 0; i < rainData.length; i++) rainData[i] = (Math.random() * 2 - 1) * 0.05;
    const rainSource = ctx.createBufferSource();
    rainSource.buffer = rainBuffer;
    rainSource.loop = true;
    rainSource.connect(this.rain!);
    rainSource.start();
  }

  private syncMusic(id: number, distance: number, pan: number, volume: number, tick: number): void {
    if (volume <= 0) return;
    const ctx = this.context!;
    let voice = this.musicVoices.get(id);
    if (!voice) {
      const gain = ctx.createGain();
      const panner = ctx.createStereoPanner();
      panner.connect(gain);
      gain.connect(this.music!);
      const osc = ctx.createOscillator();
      const noteGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = MELODY[id % MELODY.length]!;
      noteGain.gain.value = 0.045;
      osc.connect(noteGain);
      noteGain.connect(panner);
      osc.start();
      osc.onended = () => osc.disconnect();
      voice = { gain, panner, oscillator: osc, visibleFrame: this.updateFrame };
      this.musicVoices.set(id, voice);
    }
    voice.visibleFrame = this.updateFrame;
    voice.oscillator.frequency.setTargetAtTime(
      MELODY[Math.floor(tick / 20 + id) % MELODY.length]!,
      ctx.currentTime,
      0.02,
    );
    voice.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), ctx.currentTime, 0.08);
    voice.gain.gain.setTargetAtTime(volume * rideMusicGain(distance) * 0.25, ctx.currentTime, 0.12);
  }

  private play(name: SoundName, intensity = 1): void {
    if (!this.context || !this.effects || this.context.state !== 'running') return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const frequencies: Record<SoundName, number> = {
      click: 760,
      open: 520,
      close: 390,
      news: 880,
      register: 1180,
      build: 680,
      demolish: 240,
      bell: 990,
      scream: 310,
      clank: 150,
      thunder: 68,
    };
    osc.type = name === 'thunder' ? 'sawtooth' : name === 'scream' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(frequencies[name], now);
    if (name === 'scream') osc.frequency.exponentialRampToValueAtTime(150, now + 0.24);
    if (name === 'thunder') osc.frequency.exponentialRampToValueAtTime(38, now + 0.8);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.005, 0.08 * intensity), now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (name === 'thunder' ? 1 : 0.25));
    osc.connect(gain);
    gain.connect(this.effects);
    osc.start(now);
    osc.stop(now + (name === 'thunder' ? 1 : 0.27));
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
}
