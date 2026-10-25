import { RIDE_CATALOG } from '../sim/rides/ride-types';
import { RideState } from '../sim/rides/ride-store';
import { ScenarioStatus } from '../sim/scenario/scenario';
import { RideInfo, RIDE_INFO_STRIDE } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';

export interface NewsTarget {
  rideId?: number;
  x: number;
  y: number;
}

export type NewsCategory = 'ride' | 'guest' | 'park';

export interface NewsItem {
  id: number;
  category: NewsCategory;
  tick: number;
  text: string;
  /** Where the camera should go when the player clicks the message. */
  target?: NewsTarget;
}

const GUEST_MILESTONE = 100;
/** Lost guests at which the park warns that guests cannot find their way. */
const LOST_GUESTS_WARNING = 5;

/** Turns successive snapshots into the park's news messages (breakdowns, openings, milestones). */
export class NewsTracker {
  /** Newest first. */
  readonly history: NewsItem[] = [];
  private lastTick = -1;
  private rides = new Map<number, number>();
  private guestMilestone = 0;
  private status: ScenarioStatus = ScenarioStatus.Active;
  private weather = 0;
  private lostWarning = false;
  private nextId = 1;
  private primed = false;

  constructor(private readonly capacity = 50) {}

  /** Returns the messages this snapshot produced; the first snapshot only sets the baseline. */
  observe(snapshot: Snapshot): NewsItem[] {
    if (snapshot.tick < this.lastTick) this.reset();
    this.lastTick = snapshot.tick;
    const fresh: NewsItem[] = [];
    const say = (category: NewsCategory, text: string, target?: NewsTarget): void => {
      fresh.push({ id: this.nextId++, category, tick: snapshot.tick, text, target });
    };

    const seen = new Map<number, number>();
    for (let i = 0; i < snapshot.rides.count; i++) {
      const o = i * RIDE_INFO_STRIDE;
      const id = snapshot.rideInfo[o + RideInfo.Id];
      const state = snapshot.rideInfo[o + RideInfo.State];
      seen.set(id, state);
      if (!this.primed) continue;
      const name = `${RIDE_CATALOG[snapshot.rideInfo[o + RideInfo.Type] as keyof typeof RIDE_CATALOG]?.name ?? 'Ride'} #${id}`;
      const target = {
        rideId: id,
        x: snapshot.rideInfo[o + RideInfo.RideX],
        y: snapshot.rideInfo[o + RideInfo.RideY],
      };
      const before = this.rides.get(id);
      if (before === undefined) say('ride', `${name} has been built`, target);
      else if (before !== RideState.Broken && state === RideState.Broken)
        say('ride', `${name} has broken down`, target);
      else if (before === RideState.Broken && state !== RideState.Broken)
        say('ride', `${name} is back in service`, target);
    }
    this.rides = seen;

    const milestone = Math.floor(snapshot.guests.count / GUEST_MILESTONE) * GUEST_MILESTONE;
    if (this.primed && milestone > this.guestMilestone && milestone > 0)
      say('guest', `Your park now has ${milestone} guests`);
    this.guestMilestone = milestone;

    if (this.primed && snapshot.scenario.status !== this.status) {
      if (snapshot.scenario.status === ScenarioStatus.Won) say('park', 'Objective achieved');
      else if (snapshot.scenario.status === ScenarioStatus.Lost) say('park', 'Objective failed');
    }
    this.status = snapshot.scenario.status;

    if (this.primed && snapshot.weather.kind !== this.weather) {
      const text = [
        'The sun has come out',
        'It has turned cloudy',
        'It has started to rain',
        'A storm is approaching',
      ][snapshot.weather.kind];
      if (text) say('park', text);
    }
    this.weather = snapshot.weather.kind;

    const lostWarning = snapshot.economy.lostGuests >= LOST_GUESTS_WARNING;
    if (this.primed && lostWarning && !this.lostWarning)
      say(
        'park',
        "Guests can't find their way around. Connect the entrance to the rides with footpath.",
      );
    this.lostWarning = lostWarning;

    this.primed = true;
    for (const item of fresh) this.history.unshift(item);
    this.history.length = Math.min(this.history.length, this.capacity);
    return fresh;
  }

  private reset(): void {
    this.primed = false;
    this.rides = new Map();
    this.guestMilestone = 0;
    this.status = ScenarioStatus.Active;
    this.weather = 0;
    this.lostWarning = false;
  }
}
