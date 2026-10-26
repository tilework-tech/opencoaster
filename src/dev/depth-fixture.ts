import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { RideType } from '../sim/rides/ride-types';
import { PathFlag } from '../sim/map/tile-map';
import { SceneryItem } from '../sim/map/scenery';
import { Canvas2DRenderer } from '../render/canvas2d-renderer';
import { WebGL2Renderer } from '../render/webgl2-renderer';
import { project } from '../render/projection';
import type { Rotation } from '../render/projection';
import type { Camera, MapData, Renderer } from '../render/renderer';
import { RIDE_INFO_STRIDE, RideInfo, createSnapshot } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';

/**
 * Dev-only page that draws one hand-built scene through either renderer with a single guest or
 * staff member at a chosen position. Query: renderer=webgl2|canvas2d, rot=0..3, zoom, scene=name,
 * actor=guest|staff|none, gx/gy (tile units, fractional), gz (levels, fractional), w/h viewport.
 */
const SIZE = 16;
const GROUND = 2;

interface PathPiece {
  x: number;
  y: number;
  base: number;
  slopeDir?: number;
  queue?: boolean;
  additions?: number;
}

interface Scene {
  paths: PathPiece[];
  scenery: Array<{ x: number; y: number; item: SceneryItem }>;
  stall?: { x: number; y: number };
}

function row(y: number, from: number, to: number, base = GROUND): PathPiece[] {
  const out: PathPiece[] = [];
  for (let x = from; x <= to; x++) out.push({ x, y, base });
  return out;
}

const SCENES: Record<string, Scene> = {
  blank: { paths: [], scenery: [] },
  'path-flat': { paths: row(8, 3, 12), scenery: [] },
  'path-queue': {
    paths: row(8, 3, 12).map((piece) => ({ ...piece, queue: true })),
    scenery: [],
  },
  'path-raised': { paths: row(8, 3, 12, GROUND + 2), scenery: [] },
  'path-slope': {
    paths: [
      ...row(8, 3, 5),
      { x: 6, y: 8, base: GROUND, slopeDir: 0 },
      { x: 7, y: 8, base: GROUND + 1, slopeDir: 0 },
      ...row(8, 8, 12, GROUND + 2),
    ],
    scenery: [],
  },
  'path-slope-y': {
    paths: [
      ...[3, 4, 5].map((y) => ({ x: 8, y, base: GROUND })),
      { x: 8, y: 6, base: GROUND, slopeDir: 1 },
      { x: 8, y: 7, base: GROUND + 1, slopeDir: 1 },
      ...[8, 9, 10, 11, 12].map((y) => ({ x: 8, y, base: GROUND + 2 })),
    ],
    scenery: [],
  },
  bench: {
    paths: row(8, 3, 12).map((piece) =>
      piece.x === 8 ? { ...piece, additions: PathFlag.Bench } : piece,
    ),
    scenery: [],
  },
  lamp: {
    paths: row(8, 3, 12).map((piece) =>
      piece.x === 8 ? { ...piece, additions: PathFlag.Lamp } : piece,
    ),
    scenery: [],
  },
  bin: {
    paths: row(8, 3, 12).map((piece) =>
      piece.x === 8 ? { ...piece, additions: PathFlag.Bin } : piece,
    ),
    scenery: [],
  },
  shelter: {
    paths: row(8, 3, 12).map((piece) =>
      piece.x === 8 ? { ...piece, additions: PathFlag.Shelter } : piece,
    ),
    scenery: [],
  },
  tree: { paths: row(8, 3, 12), scenery: [{ x: 8, y: 7, item: SceneryItem.OakTree }] },
  'tree-on-path-side': {
    paths: row(8, 3, 12),
    scenery: [
      { x: 8, y: 9, item: SceneryItem.OakTree },
      { x: 8, y: 7, item: SceneryItem.OakTree },
    ],
  },
  hedge: { paths: row(8, 3, 12), scenery: [{ x: 8, y: 7, item: SceneryItem.Hedge }] },
  fence: { paths: row(8, 3, 12), scenery: [{ x: 8, y: 7, item: SceneryItem.WoodenFence }] },
  stall: { paths: row(8, 3, 12), scenery: [], stall: { x: 8, y: 7 } },
};

const params = new URLSearchParams(location.search);
const rotation = (Number(params.get('rot') ?? 0) % 4) as Rotation;
const zoom = Number(params.get('zoom') ?? 4);
const sceneName = params.get('scene') ?? 'blank';
const actor = params.get('actor') ?? 'guest';
let guestX = Number(params.get('gx') ?? 8.5);
let guestY = Number(params.get('gy') ?? 8.5);
let guestZ = Number(params.get('gz') ?? GROUND);
const heading = Number(params.get('dir') ?? 0);
const viewWidth = Number(params.get('w') ?? 480);
const viewHeight = Number(params.get('h') ?? 360);
const dpr = Number(params.get('dpr') ?? 1);
let focus = params.get('focus')?.split(',').map(Number) ?? null;

function buildMap(scene: Scene): MapData {
  const count = SIZE * SIZE;
  const key = (x: number, y: number): string => `${x},${y}`;
  const byTile = new Map(scene.paths.map((piece) => [key(piece.x, piece.y), piece] as const));
  const pathElements = new Int32Array(scene.paths.length * 6);
  scene.paths.forEach((piece, index) => {
    let flags = piece.additions ?? 0;
    const neighbours: Array<[number, number]> = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ];
    neighbours.forEach(([dx, dy], dir) => {
      if (byTile.has(key(piece.x + dx, piece.y + dy))) flags |= 1 << dir;
    });
    if (piece.queue) flags |= PathFlag.Queue;
    if (piece.slopeDir !== undefined) flags |= PathFlag.Sloped | (piece.slopeDir << 10);
    const o = index * 6;
    pathElements[o] = piece.x;
    pathElements[o + 1] = piece.y;
    pathElements[o + 2] = piece.base;
    pathElements[o + 3] = flags;
    pathElements[o + 4] = 0;
    pathElements[o + 5] = 0;
  });
  const sceneryElements = new Int32Array(scene.scenery.length * 5);
  scene.scenery.forEach((item, index) => {
    const o = index * 5;
    sceneryElements[o] = item.x;
    sceneryElements[o + 1] = item.y;
    sceneryElements[o + 2] = GROUND;
    sceneryElements[o + 3] = 0;
    sceneryElements[o + 4] = item.item;
  });
  return {
    width: SIZE,
    height: SIZE,
    heights: new Uint8Array(count).fill(GROUND),
    surface: new Uint8Array(count).fill(4),
    slope: new Uint8Array(count),
    ownership: new Uint8Array(count).fill(1),
    pathElements,
    pathCount: scene.paths.length,
    sceneryElements,
    sceneryCount: scene.scenery.length,
  };
}

function buildSnapshot(scene: Scene): Snapshot {
  const snapshot = createSnapshot({
    guests: 4,
    staff: 4,
    vehicles: 1,
    litter: 1,
    mapTiles: SIZE * SIZE,
    patrolAreas: 1,
    patrolWordsPerArea: 1,
  });
  const layer = actor === 'staff' ? snapshot.staff : actor === 'guest' ? snapshot.guests : null;
  if (layer) {
    layer.count = 1;
    layer.data[0] = Math.round(guestX * TILE_UNITS);
    layer.data[1] = Math.round(guestY * TILE_UNITS);
    layer.data[2] = Math.round(guestZ * Z_STEP);
    layer.data[3] = (heading & 3) << 8;
  }
  if (scene.stall) {
    snapshot.rides.count = 1;
    const o = 0;
    snapshot.rideInfo[o + RideInfo.Type] = RideType.FoodStall;
    snapshot.rideInfo[o + RideInfo.RideX] = scene.stall.x;
    snapshot.rideInfo[o + RideInfo.RideY] = scene.stall.y;
    void RIDE_INFO_STRIDE;
  }
  snapshot.park.entranceX = -1;
  snapshot.park.entranceY = -1;
  return snapshot;
}

async function main(): Promise<void> {
  const scene = SCENES[sceneName];
  if (!scene) throw new Error(`unknown scene ${sceneName}`);
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer: Renderer =
    params.get('renderer') === 'canvas2d' ? new Canvas2DRenderer() : new WebGL2Renderer();
  renderer.attach(canvas);
  renderer.resize(viewWidth, viewHeight, dpr);
  canvas.style.width = `${viewWidth}px`;
  canvas.style.height = `${viewHeight}px`;
  const map = buildMap(scene);
  renderer.setMap(map);
  const snapshot = buildSnapshot(scene);
  const centre = new Float64Array(2);
  const camera: Camera = { x: 0, y: 0, zoom, rotation };
  const lockCamera = params.get('lock') !== null;
  const place = (): void => {
    const layer = actor === 'staff' ? snapshot.staff : snapshot.guests;
    layer.data[0] = Math.round(guestX * TILE_UNITS);
    layer.data[1] = Math.round(guestY * TILE_UNITS);
    layer.data[2] = Math.round(guestZ * Z_STEP);
  };
  const frame = (): void => {
    if (actor !== 'none' && (actor === 'staff' ? snapshot.staff : snapshot.guests).count > 0)
      place();
    if (focus || !lockCamera || camera.x === 0) {
      const [fx, fy, fz] = focus ?? [guestX, guestY, guestZ];
      project(fx! * TILE_UNITS, fy! * TILE_UNITS, fz! * Z_STEP, SIZE, SIZE, rotation, centre);
      camera.x = centre[0]!;
      camera.y = centre[1]! - 8;
    }
    renderer.draw(snapshot, camera);
  };
  (window as unknown as { __move: unknown }).__move = (x: number, y: number, z: number): void => {
    guestX = x;
    guestY = y;
    guestZ = z;
    frame();
    frame();
  };
  (window as unknown as { __show: unknown }).__show = (
    at: [number, number, number] | null,
    look: [number, number, number],
  ): void => {
    focus = look;
    const layer = actor === 'staff' ? snapshot.staff : snapshot.guests;
    layer.count = at ? 1 : 0;
    if (at) [guestX, guestY, guestZ] = at;
    frame();
    frame();
  };
  // Sprite categories load lazily on first use; wait until redraws stop changing the canvas.
  let previous = '';
  let stable = 0;
  for (let i = 0; i < 400 && stable < 8; i++) {
    frame();
    const current = canvas.toDataURL();
    stable = current === previous ? stable + 1 : 0;
    previous = current;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  frame();
  frame();
  (window as unknown as { __ready: boolean; __backend: string }).__backend = renderer.backend;
  (window as unknown as { __ready: boolean }).__ready = true;
}

void main();
