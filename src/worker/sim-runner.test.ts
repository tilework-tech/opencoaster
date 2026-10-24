import { describe, expect, it } from 'vitest';
import { SimRunner } from './sim-runner';
import type { FromWorker } from './protocol';

describe('SimRunner', () => {
  it('sends the map, then snapshots with the requested guest count', () => {
    const out: FromWorker[] = [];
    let now = 0;
    const r = new SimRunner({ post: (m) => out.push(m) }, () => now);
    r.handle({ type: 'init', seed: 1, width: 16, height: 16, initialGuests: 20, maxGuests: 100 });
    expect(out.map((m) => m.type)).toEqual(['map', 'ready']);
    r.pump();
    now = 100;
    r.pump();
    const snap = out.find((m) => m.type === 'snapshot');
    expect(snap && snap.type === 'snapshot' && snap.snapshot.guests.count).toBe(20);
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
});
