import { describe, expect, it } from 'vitest';
import { RideInfo, RIDE_INFO_STRIDE, createSnapshot } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import { RideState } from '../sim/rides/ride-store';
import { RideType } from '../sim/rides/ride-types';
import { ScenarioStatus } from '../sim/scenario/scenario';
import { NewsTracker } from './news';

function snap(
  tick: number,
  rides: Array<{ id: number; state: RideState; x?: number; y?: number }>,
  guests = 0,
): Snapshot {
  const s = createSnapshot({ guests: 8, staff: 0, vehicles: 0, litter: 0 });
  s.tick = tick;
  s.guests.count = guests;
  s.rides.count = rides.length;
  rides.forEach((ride, i) => {
    const o = i * RIDE_INFO_STRIDE;
    s.rideInfo[o + RideInfo.Id] = ride.id;
    s.rideInfo[o + RideInfo.Type] = RideType.MerryGoRound;
    s.rideInfo[o + RideInfo.State] = ride.state;
    s.rideInfo[o + RideInfo.RideX] = ride.x ?? 3;
    s.rideInfo[o + RideInfo.RideY] = ride.y ?? 4;
  });
  return s;
}

describe('news tracker', () => {
  it('reports nothing for the first snapshot it sees', () => {
    const news = new NewsTracker();
    expect(news.observe(snap(1, [{ id: 1, state: RideState.Open }]))).toEqual([]);
  });

  it('reports a breakdown with a target the player can click to find the ride', () => {
    const news = new NewsTracker();
    news.observe(snap(1, [{ id: 7, state: RideState.Open, x: 9, y: 2 }]));
    const [item] = news.observe(snap(2, [{ id: 7, state: RideState.Broken, x: 9, y: 2 }]));
    expect(item.text).toBe('Merry-Go-Round #7 has broken down');
    expect(item.target).toEqual({ rideId: 7, x: 9, y: 2 });
  });

  it('reports a newly built ride and a repaired ride', () => {
    const news = new NewsTracker();
    news.observe(snap(1, []));
    expect(news.observe(snap(2, [{ id: 2, state: RideState.Closed }]))[0].text).toBe(
      'Merry-Go-Round #2 has been built',
    );
    news.observe(snap(3, [{ id: 2, state: RideState.Broken }]));
    expect(news.observe(snap(4, [{ id: 2, state: RideState.Open }]))[0].text).toBe(
      'Merry-Go-Round #2 is back in service',
    );
  });

  it('reports guest count milestones once', () => {
    const news = new NewsTracker();
    news.observe(snap(1, [], 50));
    expect(news.observe(snap(2, [], 120)).map((n) => n.text)).toEqual([
      'Your park now has 100 guests',
    ]);
    expect(news.observe(snap(3, [], 130))).toEqual([]);
  });

  it('reports the scenario outcome', () => {
    const news = new NewsTracker();
    const before = snap(1, []);
    news.observe(before);
    const after = snap(2, []);
    after.scenario.status = ScenarioStatus.Won;
    expect(news.observe(after)[0].text).toBe('Objective achieved');
  });

  it('starts over when time runs backwards, as after loading a save', () => {
    const news = new NewsTracker();
    news.observe(snap(500, [{ id: 1, state: RideState.Open }]));
    expect(news.observe(snap(10, [{ id: 1, state: RideState.Broken }]))).toEqual([]);
  });

  it('keeps the most recent messages first and caps history', () => {
    const news = new NewsTracker(3);
    news.observe(snap(1, []));
    for (let i = 1; i <= 5; i++) news.observe(snap(1 + i, [{ id: i, state: RideState.Closed }]));
    expect(news.history).toHaveLength(3);
    expect(news.history[0].text).toContain('#5');
  });
});
