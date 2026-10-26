import { describe, expect, it } from 'vitest';
import { SimRunner } from './sim-runner';
import type { FromWorker } from './protocol';
import { PriceMode } from '../sim/economy/ledger';
import { ObjectiveKind } from '../sim/scenario/scenario';

describe('SimRunner', () => {
  it('assigns a new revision whenever a pooled snapshot is published', () => {
    const revisions: number[] = [];
    let now = 0;
    const r = new SimRunner(
      {
        post: (message) => {
          if (message.type === 'snapshot') {
            revisions.push(message.snapshot.revision);
            r.handle({ type: 'recycle', snapshot: message.snapshot });
          }
        },
      },
      () => now,
    );
    r.handle({ type: 'init', seed: 1, width: 8, height: 8, initialGuests: 1, maxGuests: 10 });
    for (let i = 0; i < 4; i++) {
      now += 50;
      r.pump();
    }

    expect(revisions).toEqual([1, 2, 3]);
  });

  it('sends the map, then snapshots with the requested guest count', () => {
    const out: FromWorker[] = [];
    let now = 0;
    const r = new SimRunner({ post: (m) => out.push(m) }, () => now);
    r.handle({ type: 'init', seed: 1, width: 16, height: 16, initialGuests: 20, maxGuests: 100 });
    expect(out.map((m) => m.type)).toEqual(['map', 'ready']);
    const map = out.find((m) => m.type === 'map');
    expect(map && map.type === 'map' ? [map.entranceX, map.entranceY] : null).toEqual([-1, -1]);
    r.pump();
    now = 100;
    r.pump();
    const snap = out.find((m) => m.type === 'snapshot');
    expect(snap && snap.type === 'snapshot' && snap.snapshot.guests.count).toBe(20);
  });

  it('publishes the scenario entrance with the opening map before the first snapshot', () => {
    const out: FromWorker[] = [];
    let now = 0;
    const r = new SimRunner({ post: (m) => out.push(m) }, () => now);
    r.handle({
      type: 'init',
      seed: 11,
      width: 24,
      height: 24,
      initialGuests: 0,
      scenario: {
        id: 'camera-test',
        name: 'Camera Test',
        seed: 11,
        mapWidth: 24,
        mapHeight: 24,
        startingCash: 100_000,
        startingLoan: 0,
        maxLoan: 100_000,
        annualInterestBps: 0,
        difficultRating: false,
        priceMode: PriceMode.Admission,
        admissionPrice: 300,
        availableItemIds: [],
        inventions: [],
        entrance: { side: 'south', length: 4 },
        objective: {
          kind: ObjectiveKind.Guests,
          target: 10,
          rating: 0,
          categoryMask: 0,
          byTick: 100,
        },
      },
    });

    const map = out.find((m) => m.type === 'map');
    expect(map && map.type === 'map' ? [map.entranceX, map.entranceY] : null).toEqual([17, 17]);
    r.pump();
    now = 100;
    r.pump();
    expect(out.findIndex((message) => message.type === 'map')).toBeLessThan(
      out.findIndex((message) => message.type === 'snapshot'),
    );
  });

  it('re-sends the map after a terrain edit', () => {
    const out: FromWorker[] = [];
    let now = 0;
    const r = new SimRunner({ post: (m) => out.push(m) }, () => now);
    r.handle({ type: 'init', seed: 1, width: 16, height: 16, initialGuests: 0, maxGuests: 10 });
    r.handle({ type: 'command', command: { type: 'raiseLand', x: 6, y: 6, width: 1, height: 1 } });
    r.pump();
    now = 100;
    r.pump();
    expect(out.filter((m) => m.type === 'map').length).toBe(2);
  });

  it('stops publishing when no recycled buffers remain, and resumes after recycle', () => {
    const out: FromWorker[] = [];
    let now = 0;
    const r = new SimRunner({ post: (m) => out.push(m) }, () => now);
    r.handle({ type: 'init', seed: 1, width: 8, height: 8, initialGuests: 1, maxGuests: 10 });
    for (let i = 0; i < 10; i++) {
      now += 50;
      r.pump();
    }
    const snaps = out.filter((m) => m.type === 'snapshot');
    expect(snaps.length).toBe(3);
    const first = snaps[0];
    if (first.type !== 'snapshot') throw new Error('unreachable');
    r.handle({ type: 'recycle', snapshot: first.snapshot });
    now += 50;
    r.pump();
    expect(out.filter((m) => m.type === 'snapshot').length).toBe(4);
  });

  it('publishes snapshots no more often than the requested interval', () => {
    const published = (intervalMs: number): number => {
      const out: FromWorker[] = [];
      let now = 0;
      const r = new SimRunner(
        {
          post: (m) => {
            out.push(m);
            if (m.type === 'snapshot') r.handle({ type: 'recycle', snapshot: m.snapshot });
          },
        },
        () => now,
      );
      r.handle({ type: 'init', seed: 1, width: 8, height: 8, initialGuests: 1, maxGuests: 10 });
      r.handle({ type: 'setSnapshotInterval', ms: intervalMs });
      for (let i = 0; i < 80; i++) {
        now += 25;
        r.pump();
      }
      return out.filter((m) => m.type === 'snapshot').length;
    };
    const everyTick = published(0);
    const throttled = published(100);
    expect(everyTick).toBeGreaterThanOrEqual(70);
    expect(throttled).toBeGreaterThanOrEqual(18);
    expect(throttled).toBeLessThanOrEqual(22);
  });

  it('still advances the simulation while snapshots are throttled', () => {
    const out: FromWorker[] = [];
    let now = 0;
    const r = new SimRunner({ post: (m) => out.push(m) }, () => now);
    r.handle({ type: 'init', seed: 1, width: 8, height: 8, initialGuests: 1, maxGuests: 10 });
    r.handle({ type: 'setSnapshotInterval', ms: 1000 });
    for (let i = 0; i < 40; i++) {
      now += 25;
      r.pump();
    }
    const stats = out.filter((m) => m.type === 'stats').at(-1);
    expect(stats && stats.type === 'stats' && stats.stats.tick).toBeGreaterThan(30);
  });

  it('delivers the latest state after a throttled snapshot even when no ticks are due', () => {
    const out: FromWorker[] = [];
    let now = 0;
    const r = new SimRunner(
      {
        post: (m) => {
          out.push(m);
          if (m.type === 'snapshot') r.handle({ type: 'recycle', snapshot: m.snapshot });
        },
      },
      () => now,
    );
    r.handle({ type: 'init', seed: 1, width: 8, height: 8, initialGuests: 1, maxGuests: 10 });
    r.handle({ type: 'setSnapshotInterval', ms: 200 });
    for (let i = 0; i < 6; i++) {
      now += 25;
      r.pump();
    }
    r.handle({ type: 'setPaused', paused: true });
    now += 25;
    r.pump();
    const publishedBefore = out.filter((m) => m.type === 'snapshot').length;
    now += 500;
    r.pump();
    const snapshots = out.filter((m) => m.type === 'snapshot');
    expect(snapshots.length).toBe(publishedBefore + 1);
    const last = snapshots.at(-1);
    const stats = out.filter((m) => m.type === 'stats').at(-1);
    expect(last && last.type === 'snapshot' && last.snapshot.tick).toBe(
      stats && stats.type === 'stats' ? stats.stats.tick : -1,
    );
  });

  it('applies construction commands immediately while paused without advancing the tick', () => {
    const out: FromWorker[] = [];
    let now = 0;
    const r = new SimRunner(
      {
        post: (m) => {
          out.push(m);
          if (m.type === 'snapshot') r.handle({ type: 'recycle', snapshot: m.snapshot });
        },
      },
      () => now,
    );
    r.handle({ type: 'init', seed: 1, width: 16, height: 16, initialGuests: 0, maxGuests: 10 });
    now = 25;
    r.pump();
    now = 50;
    r.pump();
    r.handle({ type: 'setPaused', paused: true });
    r.handle({
      type: 'command',
      command: { type: 'createRide', rideType: 1, x: 4, y: 4 },
    });
    now += 25;
    r.pump();

    const snapshot = out.filter((m) => m.type === 'snapshot').at(-1);
    expect(snapshot && snapshot.type === 'snapshot' ? snapshot.snapshot.tick : -1).toBe(1);
    expect(snapshot && snapshot.type === 'snapshot' ? snapshot.snapshot.feedback.seq : -1).toBe(1);
  });
  it('applies area tool commands immediately while paused and answers area previews', () => {
    const out: FromWorker[] = [];
    let now = 0;
    const r = new SimRunner(
      {
        post: (m) => {
          out.push(m);
          if (m.type === 'snapshot') r.handle({ type: 'recycle', snapshot: m.snapshot });
        },
      },
      () => now,
    );
    r.handle({ type: 'init', seed: 1, width: 16, height: 16, initialGuests: 0, maxGuests: 10 });
    now = 25;
    r.pump();
    now = 50;
    r.pump();
    r.handle({ type: 'setPaused', paused: true });
    r.handle({
      type: 'command',
      command: { type: 'clearScenery', x: 2, y: 2, width: 3, height: 3 },
    });
    r.handle({
      type: 'command',
      command: { type: 'clearScenery', x: 8, y: 8, width: 1, height: 1 },
    });
    now += 25;
    r.pump();
    const snapshot = out.filter((m) => m.type === 'snapshot').at(-1);
    expect(snapshot && snapshot.type === 'snapshot' ? snapshot.snapshot.feedback.seq : -1).toBe(2);

    r.handle({
      type: 'previewArea',
      id: 7,
      edit: { tool: 'water', x: 2, y: 2, width: 2, height: 2, lower: false },
    });
    const preview = out.find((m) => m.type === 'areaPreview');
    expect(preview && preview.type === 'areaPreview' ? preview.id : -1).toBe(7);
  });
});
