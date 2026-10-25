import type { PlayerSettings } from '../ui/settings';
import { RideInfo, RIDE_INFO_STRIDE } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import { project } from '../render/projection';
import type { Camera } from '../render/renderer';
import { RIDE_CATALOG } from '../sim/rides/ride-types';
import type { RideType, RideTypeDef } from '../sim/rides/ride-types';
import { renderCrowdMurmur, renderMusicLoop, renderRain, rideMusicStyle } from './synth';
import type { MusicStyle, RideMusicStyle } from './synth';

export interface AudioLevels {
  sound: number;
  music: number;
}

/** Bed levels are relative to the sound volume. Crowd murmur reaches its peak at 500 guests. */
const CROWD_BED_LEVEL = 0.08;
const RAIN_BED_LEVEL = 0.03;
const RIDE_MUSIC_LEVEL = 0.35;
const PARK_THEME_LEVEL = 0.3;
/** Park theme steps back while a ride's music is audible, so the two never pile up. */
const PARK_THEME_DUCK = 0.4;

export function soundLevels(
  settings: Pick<PlayerSettings, 'soundVolume' | 'musicVolume' | 'musicOn' | 'muted'>,
): AudioLevels {
  if (settings.muted) return { sound: 0, music: 0 };
  return {
    sound: settings.soundVolume,
    music: settings.musicOn ? settings.musicVolume : 0,
  };
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

interface MusicVoice {
  style: RideMusicStyle;
  gain: GainNode;
  panner: StereoPannerNode;
  source: AudioBufferSourceNode;
  visibleFrame: number;
}

/** Main-thread, original procedural audio. It never owns or mutates simulation state. */
export class AudioEngine {
  private context: AudioContext | null = null;
  private effects: GainNode | null = null;
  private music: GainNode | null = null;
  private ambience: GainNode | null = null;
  private rain: GainNode | null = null;
  private parkTheme: GainNode | null = null;
  private lastTick = -1;
  private lastWeather = 0;
  private lastAudioEvent = 0;
  private lastRegisterTime = Number.NEGATIVE_INFINITY;
  private lastRideCount = 0;
  private updateFrame = 0;
  private readonly rideStates = new Map<number, number>();
  private readonly pendingUiSounds: Array<'click' | 'open' | 'close' | 'news'> = [];
  private readonly musicBuffers = new Map<MusicStyle, AudioBuffer>();
  private readonly musicVoices = new Map<number, MusicVoice>();
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
    const now = this.context?.currentTime ?? 0;
    for (const voice of this.musicVoices.values()) this.stopVoice(voice, now);
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
      const ctx = this.createContext();
      this.context = ctx;
      this.effects = ctx.createGain();
      this.music = ctx.createGain();
      this.ambience = ctx.createGain();
      this.rain = ctx.createGain();
      this.ambience.gain.value = 0;
      this.rain.gain.value = 0;
      this.effects.connect(ctx.destination);
      this.music.connect(ctx.destination);
      this.ambience.connect(this.effects);
      this.rain.connect(this.effects);
      this.setSettings(this.settings);
      this.startAmbience();
      this.startParkTheme();
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
    this.ambience!.gain.setTargetAtTime(
      crowdLevel(snapshot.guests.count) * CROWD_BED_LEVEL,
      now,
      0.4,
    );
    const raining = snapshot.weather.kind >= 2;
    this.rain!.gain.setTargetAtTime(raining ? RAIN_BED_LEVEL : 0, now, 0.6);
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
      const type = snapshot.rideInfo[o + RideInfo.Type];
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
      if (state === 1 && Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && level.music > 0) {
        const def: RideTypeDef | undefined = RIDE_CATALOG[type as RideType];
        this.syncMusic(id, rideMusicStyle(def?.category), distance, dx);
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
        this.releaseVoice(voice, now);
        this.musicVoices.delete(id);
      }
    }
    this.parkTheme!.gain.setTargetAtTime(
      this.musicVoices.size > 0 ? PARK_THEME_LEVEL * PARK_THEME_DUCK : PARK_THEME_LEVEL,
      now,
      0.6,
    );
  }

  dispose(): void {
    const now = this.context?.currentTime ?? 0;
    for (const voice of this.musicVoices.values()) this.stopVoice(voice, now);
    this.musicVoices.clear();
    void this.context?.close();
    this.context = null;
  }

  private startAmbience(): void {
    const sampleRate = this.context!.sampleRate;
    this.loopSource(renderCrowdMurmur(sampleRate), this.ambience!).start();
    this.loopSource(renderRain(sampleRate), this.rain!).start();
  }

  private startParkTheme(): void {
    const ctx = this.context!;
    this.parkTheme = ctx.createGain();
    this.parkTheme.gain.value = PARK_THEME_LEVEL;
    this.parkTheme.connect(this.music!);
    const source = ctx.createBufferSource();
    source.buffer = this.musicBuffer('park');
    source.loop = true;
    source.connect(this.parkTheme);
    source.start();
  }

  private loopSource(samples: Float32Array, destination: AudioNode): AudioBufferSourceNode {
    const ctx = this.context!;
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(destination);
    return source;
  }

  private musicBuffer(style: MusicStyle): AudioBuffer {
    let buffer = this.musicBuffers.get(style);
    if (!buffer) {
      const ctx = this.context!;
      const samples = renderMusicLoop(style, ctx.sampleRate);
      buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.getChannelData(0).set(samples);
      this.musicBuffers.set(style, buffer);
    }
    return buffer;
  }

  private syncMusic(id: number, style: RideMusicStyle, distance: number, pan: number): void {
    const ctx = this.context!;
    const now = ctx.currentTime;
    let voice = this.musicVoices.get(id);
    if (voice && voice.style !== style) {
      this.releaseVoice(voice, now);
      this.musicVoices.delete(id);
      voice = undefined;
    }
    if (!voice) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const panner = ctx.createStereoPanner();
      const source = ctx.createBufferSource();
      source.buffer = this.musicBuffer(style);
      source.loop = true;
      source.connect(panner);
      panner.connect(gain);
      gain.connect(this.music!);
      source.start();
      voice = { style, gain, panner, source, visibleFrame: this.updateFrame };
      this.musicVoices.set(id, voice);
    }
    voice.visibleFrame = this.updateFrame;
    voice.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, 0.08);
    voice.gain.gain.setTargetAtTime(rideMusicGain(distance) * RIDE_MUSIC_LEVEL, now, 0.12);
  }

  /** Fades a ride loop out, then stops and disconnects it, so leaving view does not click. */
  private releaseVoice(voice: MusicVoice, now: number): void {
    voice.gain.gain.setTargetAtTime(0, now, 0.05);
    this.stopVoice(voice, now + 0.25);
  }

  private stopVoice(voice: MusicVoice, when: number): void {
    voice.source.onended = () => {
      voice.source.disconnect();
      voice.panner.disconnect();
      voice.gain.disconnect();
    };
    voice.source.stop(when);
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
