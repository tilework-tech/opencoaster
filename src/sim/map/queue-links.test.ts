import { describe, expect, it } from 'vitest';
import type { World } from '../core/world';
import { flatWorld, layPath, row } from '../integration/fixtures';
import { createRide, placeRideEntranceExit } from '../rides/ride-operations';
import { refreshQueueIndex } from '../rides/queue-lines';
import { RideType } from '../rides/ride-types';
import { deserialize, SAVE_VERSION, serialize } from '../../save/save';
import { applyMapCommand } from './map-commands';
import { queueLinkMask } from './paths';
import { migrateQueueLinks } from './queue-link-migration';

type Tile = readonly [number, number];

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

const links = (w: World, [x, y]: Tile): number =>
  queueLinkMask(w.map, w.map.pathElement(w.map.index(x, y), -1));
const edges = (w: World, [x, y]: Tile): number => w.map.pathEdges(w.map.index(x, y));
const count = (mask: number): number => [0, 1, 2, 3].filter((d) => mask & (1 << d)).length;

function drag(w: World, tiles: readonly Tile[]): void {
  applyMapCommand(w, {
    type: 'placePathRun',
    placements: tiles.map(([x, y]) => ({ x, y, queue: true })),
  });
}

function snake(rows: number, x0: number, x1: number, y0: number): Tile[] {
  const out: Tile[] = [];
  for (let k = 0; k < rows; k++) {
    const xs = row(y0 + k, x0, x1).map(([x]) => x);
    if (k % 2) xs.reverse();
    for (const x of xs) out.push([x, y0 + k]);
  }
  return out;
}

/** Every queue tile of the map links to at most two neighbours, and every link is mutual. */
function expectSingleFile(w: World): void {
  const m = w.map;
  for (let i = 0; i < m.width * m.height; i++) {
    if (!m.isQueue(i)) continue;
    const mask = queueLinkMask(m, m.pathElement(i, -1));
    expect(count(mask)).toBeLessThanOrEqual(2);
    for (let d = 0; d < 4; d++) {
      if (!(mask & (1 << d))) continue;
      const n = m.neighbor(i, d);
      expect(queueLinkMask(m, m.pathElement(n, -1)) & (1 << ((d + 2) & 3))).not.toBe(0);
    }
  }
}

function queueEdgesBetween(w: World, a: Tile, b: Tile): boolean {
  for (let d = 0; d < 4; d++) {
    if (a[0] + DX[d]! === b[0] && a[1] + DY[d]! === b[1]) return (edges(w, a) & (1 << d)) !== 0;
  }
  throw new Error('tiles are not adjacent');
}

describe('queue links', () => {
  it('chain a straight drag into one line with single ends', () => {
    const w = flatWorld();
    drag(
      w,
      row(5, 3, 7).map(([x, y]) => [x, y] as Tile),
    );
    expect(count(links(w, [3, 5]))).toBe(1);
    expect(count(links(w, [7, 5]))).toBe(1);
    for (const x of [4, 5, 6]) expect(links(w, [x, 5])).toBe(0b0101);
    expect(queueEdgesBetween(w, [4, 5], [5, 5])).toBe(true);
  });

  it('keep a snake single-file even though its rows touch', () => {
    const w = flatWorld();
    const tiles = snake(3, 3, 7, 4);
    drag(w, tiles);
    expectSingleFile(w);
    for (let k = 1; k < tiles.length; k++)
      expect(queueEdgesBetween(w, tiles[k - 1]!, tiles[k]!)).toBe(true);
    for (const x of [4, 5, 6]) {
      expect(queueEdgesBetween(w, [x, 4], [x, 5])).toBe(false);
      expect(queueEdgesBetween(w, [x, 5], [x, 6])).toBe(false);
    }
  });

  it('keep a 2-wide parallel build as two lines with rails between them', () => {
    const w = flatWorld();
    drag(
      w,
      row(5, 3, 8).map(([x, y]) => [x, y] as Tile),
    );
    drag(
      w,
      row(6, 4, 7).map(([x, y]) => [x, y] as Tile),
    );
    expectSingleFile(w);
    for (let x = 4; x <= 7; x++) {
      expect(queueEdgesBetween(w, [x, 5], [x, 6])).toBe(false);
      expect(queueEdgesBetween(w, [x, 6], [x, 5])).toBe(false);
    }
    expect(links(w, [4, 6])).toBe(0b0001);
    expect(links(w, [7, 6])).toBe(0b0100);
  });

  it('turns a drag that starts beside a free line end into a bend of that line', () => {
    const w = flatWorld();
    drag(
      w,
      row(5, 3, 6).map(([x, y]) => [x, y] as Tile),
    );
    drag(
      w,
      row(6, 3, 6).map(([x, y]) => [x, y] as Tile),
    );
    expectSingleFile(w);
    expect(queueEdgesBetween(w, [3, 5], [3, 6])).toBe(true);
    expect(queueEdgesBetween(w, [4, 5], [4, 6])).toBe(false);
  });

  it('never forms a junction: a piece beside the middle of a line stays unlinked', () => {
    const w = flatWorld();
    drag(
      w,
      row(5, 3, 7).map(([x, y]) => [x, y] as Tile),
    );
    layPath(w, [[5, 6]], true);
    layPath(w, [[5, 4]], true);
    expectSingleFile(w);
    expect(links(w, [5, 5])).toBe(0b0101);
    expect(links(w, [5, 6])).toBe(0);
    expect(links(w, [5, 4])).toBe(0);
    expect(queueEdgesBetween(w, [5, 5], [5, 6])).toBe(false);
  });

  it('links a piece between two line ends to one of them only', () => {
    const w = flatWorld();
    layPath(
      w,
      [
        [3, 5],
        [4, 5],
      ],
      true,
    );
    layPath(
      w,
      [
        [6, 5],
        [7, 5],
      ],
      true,
    );
    layPath(w, [[5, 5]], true);
    expectSingleFile(w);
    expect(count(links(w, [5, 5]))).toBe(1);
  });

  it('extends the end of the line that leads to a ride entrance', () => {
    const w = flatWorld();
    layPath(w, row(5, 2, 7));
    layPath(w, row(5, 9, 11), true);
    layPath(w, [[13, 4]]);
    layPath(w, [[7, 5]], true);
    const id = createRide(w, RideType.MerryGoRound, 11, 3);
    placeRideEntranceExit(w, id, { x: 11, y: 5 }, { x: 13, y: 4 });
    refreshQueueIndex(w);
    layPath(w, [[8, 5]], true);
    expect(links(w, [8, 5])).toBe(0b0001);
    expect(queueEdgesBetween(w, [8, 5], [9, 5])).toBe(true);
    expect(queueEdgesBetween(w, [8, 5], [7, 5])).toBe(false);
  });

  it('joins a ride entrance when a drag ends in front of it', () => {
    const w = flatWorld();
    layPath(w, row(5, 2, 8));
    layPath(w, [[11, 5]], true);
    layPath(w, [[13, 4]]);
    const id = createRide(w, RideType.MerryGoRound, 11, 3);
    placeRideEntranceExit(w, id, { x: 11, y: 5 }, { x: 13, y: 4 });
    refreshQueueIndex(w);
    drag(
      w,
      row(6, 8, 11).map(([x, y]) => [x, y] as Tile),
    );
    refreshQueueIndex(w);
    expectSingleFile(w);
    expect(links(w, [11, 5])).toBe(0b0010);
    expect(links(w, [11, 6])).toBe(0b1100);
    expect(w.queues.tiles[0]).toBe(4);
    expect(w.queues.openTile[0]).toBe(w.map.index(8, 6));
  });

  it('does not join a ride entrance from its side when a drag ends beside it', () => {
    const w = flatWorld();
    layPath(w, row(5, 2, 7));
    layPath(w, [[11, 5]], true);
    layPath(w, [[13, 4]]);
    const id = createRide(w, RideType.MerryGoRound, 11, 3);
    placeRideEntranceExit(w, id, { x: 11, y: 5 }, { x: 13, y: 4 });
    refreshQueueIndex(w);
    drag(
      w,
      row(5, 8, 10).map(([x, y]) => [x, y] as Tile),
    );
    refreshQueueIndex(w);
    expect(links(w, [11, 5])).toBe(0);
    expect(links(w, [10, 5]) & 0b0001).toBe(0);
  });

  it('never closes a line into a ring', () => {
    const w = flatWorld();
    const loop: Tile[] = [...row(5, 3, 6), ...row(6, 3, 6).reverse()].map(([x, y]) => [x, y]);
    drag(w, loop);
    expectSingleFile(w);
    expect(queueEdgesBetween(w, [3, 5], [3, 6])).toBe(false);
    expect(queueEdgesBetween(w, [6, 5], [6, 6])).toBe(true);
  });

  it('splits the line cleanly when a tile is removed', () => {
    const w = flatWorld();
    drag(
      w,
      row(5, 3, 9).map(([x, y]) => [x, y] as Tile),
    );
    applyMapCommand(w, { type: 'removePath', x: 6, y: 5 });
    expectSingleFile(w);
    expect(links(w, [5, 5])).toBe(0b0100);
    expect(links(w, [7, 5])).toBe(0b0001);
    expect(count(links(w, [4, 5]))).toBe(2);
    expect(queueEdgesBetween(w, [5, 5], [4, 5])).toBe(true);
  });

  describe('migration', () => {
    function block(): { w: World; entrance: Tile } {
      const w = flatWorld();
      layPath(w, row(5, 2, 4));
      for (let y = 5; y <= 7; y++) layPath(w, row(y, 5, 7), true);
      layPath(w, [[8, 5]], true);
      layPath(w, [[9, 4]]);
      const id = createRide(w, RideType.MerryGoRound, 10, 6);
      placeRideEntranceExit(w, id, { x: 8, y: 5 }, { x: 9, y: 4 });
      refreshQueueIndex(w);
      return { w, entrance: [8, 5] };
    }

    function wipeLinks(w: World): void {
      for (let i = 0; i < w.map.width * w.map.height; i++)
        for (let e = w.map.firstElement(i); e >= 0; e = w.map.nextElement(e))
          w.map.elData[e] &= ~(0xf << 8);
    }

    it('chains a plaza of queue tiles from the entrance, at most two links each', () => {
      const { w, entrance } = block();
      wipeLinks(w);
      migrateQueueLinks(w);
      refreshQueueIndex(w);
      expectSingleFile(w);
      expect(count(links(w, entrance))).toBeLessThanOrEqual(1);
      expect(w.queues.orphanTiles).toBe(0);
      expect(w.queues.tiles[0]).toBeGreaterThan(0);
    });

    it('is deterministic', () => {
      const a = block().w;
      const b = block().w;
      for (const w of [a, b]) {
        wipeLinks(w);
        migrateQueueLinks(w);
      }
      expect(Array.from(a.map.elData)).toEqual(Array.from(b.map.elData));
    });

    it('chains orphaned queue tiles into lines of their own', () => {
      const w = flatWorld();
      layPath(w, row(5, 2, 4), true);
      layPath(w, row(6, 2, 4), true);
      wipeLinks(w);
      migrateQueueLinks(w);
      expectSingleFile(w);
      let total = 0;
      for (const y of [5, 6]) for (const x of [2, 3, 4]) total += count(links(w, [x, y]));
      expect(total).toBe(10);
    });

    it('runs when an older save is loaded', () => {
      const { w } = block();
      const bytes = serialize(w);
      const headerLen = new DataView(bytes.buffer).getUint32(4, true);
      const header = new TextDecoder().decode(bytes.subarray(8, 8 + headerLen));
      const old = header.replace(`"version":${SAVE_VERSION}`, '"version":24');
      expect(old).not.toBe(header);
      const patched = new Uint8Array(bytes);
      patched.set(new TextEncoder().encode(old), 8);
      const restored = deserialize(patched);
      expectSingleFile(restored);
    });
  });
});
