import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { PathFlag, PathStyle } from '../sim/map/tile-map';
import { SceneryItem } from '../sim/map/scenery';
import { RideType } from '../sim/rides/ride-types';
import { FLOWER_BED } from '../sim/staff/grounds';
import { flowerbedPreviewGhost } from '../app/tools/flowerbed-preview';
import { RideFlag, RideInfo, RIDE_INFO_STRIDE, createSnapshot } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import { Canvas2DRenderer } from './canvas2d-renderer';
import type { CanvasAtlas } from './canvas-atlas';
import {
  pickTile,
  project,
  rotateDirection,
  rotateOffset,
  worldToScreen,
  screenToWorld,
} from './projection';
import type { Rotation } from './projection';
import type { Camera, MapData, PathPieceGhost, SpriteGhost } from './renderer';
import { spritePages } from './sprite-pages';
import type { SpriteEntry } from './sprite-pages';
import { WebGL2Renderer } from './webgl2-renderer';

const ROTATIONS: Rotation[] = [0, 1, 2, 3];
const W = 12;
const H = 10;
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/** A drawn sprite: its key and anchor point in map-origin screen pixels. */
interface Placement {
  key: string;
  sx: number;
  sy: number;
}

/** One object of the fixture park and where it must land. */
interface Expectation {
  name: string;
  /** Sprite key prefix of the drawn object. */
  prefix: string;
  /** Anchor in world tile units (tile centre = integer + 0.5) and height in levels. */
  x: number;
  y: number;
  z: number;
  /** Required view index (`view-N` / `direction-N`) of the sprite at a camera rotation. */
  view?: (rotation: Rotation) => number;
  /** Pixel tolerance of the anchor, for sprites pivoted on a tile edge rather than its centre. */
  tolerance?: number;
}

function heightAt(x: number, y: number): number {
  return (x * 3 + y * 5) % 4;
}

function fixtureMap(): MapData {
  const heights = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) heights[y * W + x] = heightAt(x, y);
  const map: MapData = {
    width: W,
    height: H,
    heights,
    surface: new Uint8Array(W * H),
    slope: new Uint8Array(W * H),
    waterLevel: new Uint8Array(W * H),
  };
  // Path tiles: a plain piece, a bench with two open edges, a queue piece and a lamp.
  const paths: number[][] = [
    [4, 4, heightAt(4, 4), PathFlag.Edges & 0b0100, 0, PathStyle.Tarmac],
    [5, 4, heightAt(5, 4), PathFlag.Bench | 0b0101, 0, PathStyle.Tarmac],
    [4, 5, heightAt(4, 5), PathFlag.Queue | 0b1010, 0, PathStyle.Tarmac],
    [7, 4, heightAt(7, 4), PathFlag.Lamp | 0b0101, 0, PathStyle.Tarmac],
    [7, 6, heightAt(7, 6), PathFlag.Bin | 0b0011, 0, PathStyle.Tarmac],
  ];
  map.pathElements = Int32Array.from(paths.flat());
  map.pathCount = paths.length;
  const scenery: number[][] = [
    [2, 2, heightAt(2, 2), 0, SceneryItem.OakTree],
    [2, 3, heightAt(2, 3), 0, SceneryItem.Hedge],
    [3, 2, heightAt(3, 2), 0, SceneryItem.WoodenFence],
  ];
  map.sceneryElements = Int32Array.from(scenery.flat());
  map.sceneryCount = scenery.length;
  map.entranceX = 0;
  map.entranceY = 5;
  return map;
}

/** Layer rows are fixed-point x, y, z, metadata. */
function fixedRow(tx: number, ty: number, level: number, metadata: number): number[] {
  return [Math.round(tx * TILE_UNITS), Math.round(ty * TILE_UNITS), level * Z_STEP, metadata];
}

const STALL = { tile: [3, 4] as const, facing: 0 };
const FLAT_RIDE = { tile: [9, 7] as const, entrance: [9, 6] as const, exit: [10, 7] as const };

function fixtureSnapshot(map: MapData): Snapshot {
  const snapshot = createSnapshot({
    guests: 2,
    staff: 2,
    vehicles: 0,
    litter: 2,
    rides: 4,
    mapTiles: W * H,
  });
  snapshot.park.entranceX = 0;
  snapshot.park.entranceY = 5;
  snapshot.grounds[6 * W + 6] = FLOWER_BED;
  // Guest heading east and a staff member heading south, mid-tile.
  snapshot.guests.count = 1;
  snapshot.guests.data.set(fixedRow(6.5, 2.5, heightAt(6, 2), (0 << 24) | (1 << 16) | 3));
  snapshot.staff.count = 1;
  snapshot.staff.data.set(fixedRow(8.25, 3.75, heightAt(8, 3), 1 | (1 << 8)));
  snapshot.litter.count = 1;
  snapshot.litter.data.set(fixedRow(5.5, 7.5, heightAt(5, 7), 0));
  snapshot.rides.count = 2;
  const rides = [
    { type: RideType.MerryGoRound, tile: FLAT_RIDE.tile, hut: true },
    { type: RideType.FoodStall, tile: STALL.tile, hut: false },
  ];
  rides.forEach((ride, i) => {
    const o = i * RIDE_INFO_STRIDE;
    snapshot.rideInfo[o + RideInfo.Id] = i;
    snapshot.rideInfo[o + RideInfo.Type] = ride.type;
    snapshot.rideInfo[o + RideInfo.RideX] = ride.tile[0];
    snapshot.rideInfo[o + RideInfo.RideY] = ride.tile[1];
    if (ride.hut) {
      snapshot.rideInfo[o + RideInfo.Flags] = RideFlag.EntrancePlaced | RideFlag.ExitPlaced;
      snapshot.rideInfo[o + RideInfo.EntranceX] = FLAT_RIDE.entrance[0];
      snapshot.rideInfo[o + RideInfo.EntranceY] = FLAT_RIDE.entrance[1];
      snapshot.rideInfo[o + RideInfo.ExitX] = FLAT_RIDE.exit[0];
      snapshot.rideInfo[o + RideInfo.ExitY] = FLAT_RIDE.exit[1];
    }
    snapshot.rides.data.set([ride.tile[0] * TILE_UNITS, ride.tile[1] * TILE_UNITS, 0, i], i * 4);
  });
  map.pathElements = Int32Array.from([
    ...map.pathElements!,
    // Path tile at the stall front so the stall faces +x... (world direction 0 -> path at x+1).
    STALL.tile[0] + 1,
    STALL.tile[1],
    heightAt(STALL.tile[0] + 1, STALL.tile[1]),
    0b0100,
    0,
    PathStyle.Tarmac,
  ]);
  map.pathCount = map.pathElements.length / 6;
  return snapshot;
}

function tileCentre(x: number, y: number): [number, number] {
  return [x + 0.5, y + 0.5];
}

function expectations(): Expectation[] {
  const level = (x: number, y: number) => heightAt(x, y);
  const out: Expectation[] = [];
  const centre = (
    name: string,
    prefix: string,
    x: number,
    y: number,
    extra: Partial<Expectation>,
  ) =>
    out.push({
      name,
      prefix,
      x: x + 0.5,
      y: y + 0.5,
      z: level(x, y),
      ...extra,
    });
  centre('path', 'paths/', 4, 4, {});
  centre('queue path', 'paths/queue/', 4, 5, {});
  centre('oak tree', 'trees/tree-oak', 2, 2, { tolerance: 20 });
  centre('hedge', 'scenery/hedge', 2, 3, { tolerance: 20 });
  centre('wooden fence', 'scenery/wooden-fence', 3, 2, { tolerance: 20 });
  centre('flower bed', 'scenery/flower-bed', 6, 6, { view: (r) => r, tolerance: 40 });
  centre('stall', 'stalls/', STALL.tile[0], STALL.tile[1], { view: (r) => r });
  centre('flat ride', 'rides/flat/', FLAT_RIDE.tile[0], FLAT_RIDE.tile[1], { view: (r) => r });
  centre('ride entrance', 'rides/flat/stations/', FLAT_RIDE.entrance[0], FLAT_RIDE.entrance[1], {
    view: (r) => r,
  });
  centre('park entrance', 'scenery/park-entrance', 0, 5, { view: (r) => r });
  out.push({
    name: 'guest',
    prefix: 'people/guest-walk',
    x: 6.5,
    y: 2.5,
    z: level(6, 2),
  });
  out.push({
    name: 'staff',
    prefix: 'people/staff/',
    x: 8.25,
    y: 3.75,
    z: level(8, 3),
    view: (r) => rotateDirection(1, r),
  });
  out.push({
    name: 'litter',
    prefix: 'litter/',
    x: 5.5,
    y: 7.5,
    z: level(5, 7),
    tolerance: 20,
    view: (r) => r,
  });
  // Path additions stand 96/256 tile inside the tile toward each open edge.
  for (const edge of [1, 3]) {
    const [dx, dy] = DIRS[edge]!;
    out.push({
      name: `bench on edge ${edge}`,
      prefix: 'scenery/bench/',
      x: 5.5 + dx * 0.375,
      y: 4.5 + dy * 0.375,
      z: level(5, 4),
      view: (r) => rotateDirection(edge, r),
    });
  }
  return out;
}

class FakeAtlas {
  readonly ids = new Map<string, number>();
  readonly names: string[] = [];

  resolve(name: string): SpriteEntry {
    let id = this.ids.get(name);
    if (id === undefined) {
      id = this.names.length;
      this.ids.set(name, id);
      this.names.push(name);
    }
    return {
      category: 'world',
      frames: Array.from({ length: 160 }, (_, i) => ({
        page: 0,
        x: id * 1000 + i,
        y: 0,
        width: 20,
        height: 20,
      })),
      anchor: { x: 10, y: 20 },
      footprint: { width: 1, height: 1 },
    };
  }

  pageImage(): object {
    return {};
  }
}

class RecordingContext {
  readonly canvas = { width: 1, height: 1 };
  readonly images: Array<{ source: number; x: number; y: number }> = [];
  imageSmoothingEnabled = true;
  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;
  globalAlpha = 1;
  private current = [1, 0, 0, 1, 0, 0];
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.current = [a, b, c, d, e, f];
  }
  drawImage(...args: unknown[]): void {
    if (args.length !== 9) return;
    this.images.push({ source: args[1] as number, x: Number(args[5]), y: Number(args[6]) });
  }
  fillRect(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  quadraticCurveTo(): void {}
  closePath(): void {}
  fill(): void {}
  arc(): void {}
  stroke(): void {}
  save(): void {}
  restore(): void {}
  transform(): void {}
  clip(): void {}
  scale(): void {}
  translate(): void {}
  rotate(): void {}
  getTransform(): number[] {
    return this.current;
  }
}

function canvasPlacements(
  map: MapData,
  snapshot: Snapshot,
  cameraRotation: Rotation,
  renderer = new Canvas2DRenderer(),
): { placements: Placement[]; renderer: Canvas2DRenderer } {
  const context = new RecordingContext();
  const atlas = new FakeAtlas();
  renderer.attach({ getContext: () => context } as unknown as HTMLCanvasElement);
  renderer.resize(2400, 1800, 1);
  (renderer as unknown as { atlas: CanvasAtlas }).atlas = atlas as unknown as CanvasAtlas;
  renderer.setMap(map);
  renderer.draw(snapshot, { x: 0, y: 0, zoom: 1, rotation: cameraRotation });
  return {
    renderer,
    placements: context.images.map((image) => ({
      key: `${atlas.names[Math.floor(image.source / 1000)]!}#${image.source % 1000}`,
      sx: image.x + 10,
      sy: image.y + 20,
    })),
  };
}

function webglPlacements(
  map: MapData,
  snapshot: Snapshot,
  rotation: Rotation,
  ghosts: { path?: PathPieceGhost[]; sprite?: SpriteGhost[] } = {},
): Placement[] {
  const renderer = new WebGL2Renderer();
  const camera: Camera = { x: 0, y: 0, zoom: 1, rotation };
  const placements: Placement[] = [];
  const probe = new Float64Array(2);
  const test = renderer as unknown as Record<string, (...args: unknown[]) => void>;
  test.append = (x, y, z, _w, _h, sprite) => {
    if (typeof sprite !== 'string') return;
    project(x as number, y as number, z as number, map.width, map.height, rotation, probe);
    placements.push({ key: sprite, sx: probe[0]!, sy: probe[1]! });
  };
  renderer.setGhosts(ghosts.path ?? []);
  renderer.setSpriteGhosts(ghosts.sprite ?? []);
  const args = [map, camera, 2400, 1800];
  test.appendAmbientTrees!(...args);
  test.appendGrounds!(snapshot, ...args);
  test.appendPathElements!(...args);
  test.appendPathGhosts!(...args);
  test.appendSceneryElements!(...args);
  test.appendSpriteGhosts!(...args);
  test.appendParkGate!(snapshot, ...args);
  test.appendRideMarkers!(snapshot, ...args);
  test.appendRides!(snapshot, ...args);
  test.appendGuests!(snapshot.guests, snapshot.tick, ...args);
  test.appendStaff!(snapshot.staff, snapshot.tick, ...args);
  test.appendVariantLayer!(
    snapshot.litter,
    (kind: number) => `litter/${kind === 1 ? 'vomit' : 'trash'}/view-${rotation}`,
    ...args,
    12,
    12,
  );
  return placements;
}

const PROBES = {
  canvas2d: (map: MapData, snapshot: Snapshot, rotation: Rotation) =>
    canvasPlacements(map, snapshot, rotation).placements,
  webgl2: (map: MapData, snapshot: Snapshot, rotation: Rotation) =>
    webglPlacements(map, snapshot, rotation),
};

function viewIndex(key: string): number | null {
  const match = /(?:view|direction)-(\d)(?:#\d+)?$/.exec(key.split('#')[0]!);
  return match ? Number(match[1]) : null;
}

describe('rotation consistency', () => {
  beforeEach(() => {
    const atlas = new FakeAtlas();
    vi.spyOn(spritePages, 'resolve').mockImplementation((name: string) => atlas.resolve(name));
  });
  afterEach(() => vi.restoreAllMocks());

  describe.each(Object.entries(PROBES))('%s anchors', (_backend, probe) => {
    it.each(ROTATIONS)(
      'lands every fixture object on its world tile at rotation %i',
      (rotation) => {
        const map = fixtureMap();
        const snapshot = fixtureSnapshot(map);
        const placements = probe(map, snapshot, rotation);
        for (const e of expectations()) {
          const [sx, sy] = worldToScreen(e.x, e.y, e.z, rotation, map);
          const candidates = placements.filter((p) => p.key.startsWith(e.prefix));
          expect(candidates.length, `${e.name} is drawn at rotation ${rotation}`).toBeGreaterThan(
            0,
          );
          const best = Math.min(...candidates.map((p) => Math.hypot(p.sx - sx, p.sy - sy)));
          // Allow the sub-pixel tile-surface lift (1/64 level) the painters add to stand on a surface.
          expect(best, `${e.name} anchor offset (px) at rotation ${rotation}`).toBeLessThanOrEqual(
            e.tolerance ?? 1.5,
          );
          if (e.view) {
            const views = candidates.map((p) => viewIndex(p.key));
            expect(views, `${e.name} view index at rotation ${rotation}`).toContain(
              e.view(rotation),
            );
          }
        }
      },
    );

    it.each(ROTATIONS)(
      'keeps a stall one tile from its path at the rotated offset at rotation %i',
      (rotation) => {
        const map = fixtureMap();
        const snapshot = fixtureSnapshot(map);
        const placements = probe(map, snapshot, rotation);
        const stall = placements.find((p) => p.key.startsWith('stalls/'))!;
        const [px, py] = worldToScreen(
          STALL.tile[0] + 1.5,
          STALL.tile[1] + 0.5,
          heightAt(STALL.tile[0] + 1, STALL.tile[1]),
          rotation,
          map,
        );
        const [sx, sy] = worldToScreen(
          STALL.tile[0] + 0.5,
          STALL.tile[1] + 0.5,
          heightAt(STALL.tile[0], STALL.tile[1]),
          rotation,
          map,
        );
        const path = placements.find(
          (p) => p.key.startsWith('paths/') && Math.hypot(p.sx - px, p.sy - py) < 2,
        );
        expect(path, 'adjacent path tile is drawn').toBeDefined();
        expect(path!.sx - stall.sx).toBeCloseTo(px - sx, -0.5);
        expect(path!.sy - stall.sy).toBeCloseTo(py - sy, -0.5);
        const [dx, dy] = rotateOffset(1, 0, rotation);
        expect(Math.sign(Math.round(path!.sx - stall.sx))).toBe(Math.sign(dx - dy));
      },
    );
  });

  describe.each(Object.entries(PROBES))('%s rotation invariance', (_backend, probe) => {
    it('offsets every object from its world anchor by the same screen vector at every rotation', () => {
      const map = fixtureMap();
      const snapshot = fixtureSnapshot(map);
      const residuals = ROTATIONS.map((rotation) => {
        const placements = probe(map, snapshot, rotation);
        return expectations().map((e) => {
          const [sx, sy] = worldToScreen(e.x, e.y, e.z, rotation, map);
          const best = placements
            .filter((p) => p.key.startsWith(e.prefix))
            .map((p) => [p.sx - sx, p.sy - sy] as const)
            .sort((a, b) => Math.hypot(...a) - Math.hypot(...b))[0]!;
          return { name: e.name, dx: best[0], dy: best[1] };
        });
      });
      for (const rotation of [1, 2, 3])
        residuals[rotation]!.forEach((r, i) => {
          expect(r.dx, `${r.name} dx at rotation ${rotation}`).toBeCloseTo(residuals[0]![i]!.dx, 0);
          expect(r.dy, `${r.name} dy at rotation ${rotation}`).toBeCloseTo(residuals[0]![i]!.dy, 0);
        });
    });
  });

  it('draws the guest sprite for its heading as seen from the camera', () => {
    for (const rotation of ROTATIONS) {
      const map = fixtureMap();
      const snapshot = fixtureSnapshot(map);
      // heading 1 (world +y) is stored in the guest row metadata
      const heading = 1;
      const expected = rotateDirection(heading, rotation);
      for (const placements of [
        canvasPlacements(map, snapshot, rotation).placements,
        webglPlacements(map, snapshot, rotation),
      ]) {
        const guest = placements.find((p) => p.key.startsWith('people/guest-walk'))!;
        // key is `people/guest-walk#N`, N = palette*16 + direction*4 + frame
        const index = Number(guest.key.split('#')[1]);
        expect(Math.floor((index % 16) / 4), `rotation ${rotation}`).toBe(expected);
      }
    }
  });

  it('draws a flower-bed ghost and placed bed at the same anchor', () => {
    for (const rotation of ROTATIONS) {
      const map = fixtureMap();
      const snapshot = fixtureSnapshot(map);
      const placements = webglPlacements(map, snapshot, rotation, {
        sprite: [flowerbedPreviewGhost(6, 6, heightAt(6, 6), 0, rotation)],
      });
      const beds = placements.filter((p) => p.key.startsWith('scenery/flower-bed'));
      expect(beds.length, `rotation ${rotation}`).toBeGreaterThanOrEqual(2);
      for (const bed of beds) {
        expect(bed.sx, `rotation ${rotation}`).toBeCloseTo(beds[0]!.sx, 0);
        expect(bed.sy, `rotation ${rotation}`).toBeCloseTo(beds[0]!.sy, 0);
      }
    }
  });

  describe('picking', () => {
    const viewport = { width: 800, height: 600 };
    it.each(ROTATIONS)(
      'pickTile inverts worldToScreen on flat and sloped ground at rotation %i',
      (rotation) => {
        const map = fixtureMap();
        map.heights.fill(2);
        map.heights[7 * W + 3] = 4;
        map.slope[2 * W + 10] = 0b0110;
        const hazards: Array<[number, number]> = [
          [10, 2],
          [3, 7],
        ];
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const near = hazards.some(
              ([hx, hy]) =>
                Math.abs(hx - x) + Math.abs(hy - y) === 1 ||
                (hx - x) * (hy - y) === 1 ||
                ((hx - x) * (hy - y) === -1 && Math.abs(hx - x) === 1),
            );
            if (near) continue;
            const level = map.heights[y * W + x]!;
            const slopeLift = map.slope[y * W + x]! !== 0 ? 0.5 : 0;
            const [sx, sy] = worldToScreen(x + 0.5, y + 0.5, level + slopeLift, rotation, map);
            const camera = { x: 0, y: 0, zoom: 1, rotation };
            const picked = pickTile(
              sx + viewport.width / 2,
              sy + viewport.height / 2,
              map,
              camera,
              viewport,
            );
            expect(picked, `tile ${x},${y}`).toEqual([x, y]);
          }
      },
    );

    it('screenToWorld returns the tile centre for a projected tile centre', () => {
      const map = fixtureMap();
      for (const rotation of ROTATIONS) {
        const [sx, sy] = worldToScreen(5.5, 3.5, 2, rotation, map);
        const [x, y] = screenToWorld(sx, sy, 2, rotation, map);
        expect([x, y]).toEqual([5.5, 3.5]);
      }
    });
  });

  describe('rotating four times', () => {
    it('returns the same Canvas2D frame as a fresh renderer', () => {
      const map = fixtureMap();
      const snapshot = fixtureSnapshot(map);
      const fresh = canvasPlacements(map, snapshot, 0).placements;
      const renderer = new Canvas2DRenderer();
      let again: Placement[] = [];
      for (const rotation of [0, 1, 2, 3, 0] as Rotation[])
        again = canvasPlacements(map, snapshot, rotation, renderer).placements;
      expect(again).toEqual(fresh);
    });
  });
});

// Keep tileCentre referenced for fixture helpers used by e2e parity.
void tileCentre;
