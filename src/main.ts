import { SimClient } from './worker/sim-client';
import { createRenderer } from './render/create-renderer';
import type { Camera, MapData } from './render/renderer';
import { pickTile, project } from './render/projection';
import type { Rotation } from './render/projection';
import { Hud } from './ui/hud';
import { GameUI } from './ui/game-ui';
import type { GuestSelection, ToolMode } from './ui/game-ui';
import { DEFAULT_MAP_SIZE, TILE_UNITS } from './sim/core/constants';

const root = document.getElementById('app') as HTMLElement;
const selection = createRenderer(document.getElementById('game') as HTMLCanvasElement);
const canvas = selection.canvas;
const renderer = selection.renderer;

const sim = new SimClient({
  seed: 1,
  width: DEFAULT_MAP_SIZE,
  height: DEFAULT_MAP_SIZE,
  initialGuests: 1000,
});
sim.onMap = (map) => renderer.setMap(map);

const camera: Camera = { x: 0, y: (DEFAULT_MAP_SIZE * 32) / 2, zoom: 1, rotation: 0 };
const hud = new Hud(root);
let paused = false;
let selectedTool: ToolMode = 'select';
let selectedGuest: GuestSelection | null = null;
const gameUi = new GameUI(root, {
  setPaused(value) {
    paused = value;
    sim.setPaused(value);
  },
  setSpeed(speed) {
    sim.setSpeed(speed);
  },
  rotate(direction) {
    camera.rotation = ((camera.rotation + direction + 4) % 4) as Rotation;
  },
  setTool(tool) {
    selectedTool = tool;
  },
  spawnGuests() {
    sim.command({ type: 'spawnGuests', count: 1000 });
  },
});

function resize(): void {
  renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
}
window.addEventListener('resize', resize);
resize();

const keys = new Set<string>();
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (event.repeat && ['q', 'e', 'g', ' '].includes(key)) return;
  keys.add(key);
  if (key === 'q') camera.rotation = ((camera.rotation + 3) % 4) as Rotation;
  if (key === 'e') camera.rotation = ((camera.rotation + 1) % 4) as Rotation;
  if (key === 'g') sim.command({ type: 'spawnGuests', count: 1000 });
  if (key === ' ') {
    event.preventDefault();
    gameUi.togglePause();
    gameUi.setToolStatus(paused ? 'Simulation paused.' : 'Simulation resumed.');
  }
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener(
  'wheel',
  (event) => {
    const rect = canvas.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const anchorX = camera.x + (localX - rect.width / 2) / camera.zoom;
    const anchorY = camera.y + (localY - rect.height / 2) / camera.zoom;
    camera.zoom = Math.max(0.25, Math.min(4, camera.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    camera.x = anchorX - (localX - rect.width / 2) / camera.zoom;
    camera.y = anchorY - (localY - rect.height / 2) / camera.zoom;
    event.preventDefault();
  },
  { passive: false },
);

let pointerDown: { id: number; x: number; y: number; moved: boolean } | null = null;
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  pointerDown = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!pointerDown || pointerDown.id !== event.pointerId) return;
  const dx = event.clientX - pointerDown.x;
  const dy = event.clientY - pointerDown.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) pointerDown.moved = true;
  if (!pointerDown.moved) return;
  camera.x -= event.movementX / camera.zoom;
  camera.y -= event.movementY / camera.zoom;
});
canvas.addEventListener('pointerup', (event) => {
  if (!pointerDown || pointerDown.id !== event.pointerId) return;
  if (!pointerDown.moved) handleCanvasClick(event);
  pointerDown = null;
});
canvas.addEventListener('pointercancel', () => (pointerDown = null));

function handleCanvasClick(event: PointerEvent): void {
  const rect = canvas.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const map = sim.map;
  if (!map) return;
  const tile = pickTile(localX, localY, map, camera, { width: rect.width, height: rect.height });
  if (selectedTool !== 'select') {
    gameUi.setToolStatus(
      tile
        ? `${selectedTool[0].toUpperCase()}${selectedTool.slice(1)} tool · tile ${tile[0]}, ${tile[1]} · placement command is not available yet.`
        : `${selectedTool[0].toUpperCase()}${selectedTool.slice(1)} tool · outside the park map.`,
    );
    return;
  }
  const guestDetails = findGuestAt(localX, localY, rect.width, rect.height, map, camera);
  selectedGuest =
    guestDetails && sim.latest ? { details: guestDetails, tick: sim.latest.tick } : null;
  gameUi.setToolStatus(tile ? `Tile ${tile[0]}, ${tile[1]}` : 'Outside the park map.');
  gameUi.update(sim.latest, sim.stats, selectedGuest);
}

function findGuestAt(
  screenX: number,
  screenY: number,
  viewportWidth: number,
  viewportHeight: number,
  map: MapData,
  cam: Camera,
): string | null {
  const layer = sim.latest?.guests;
  if (!layer) return null;
  const projected = new Float64Array(2);
  let nearest = -1;
  let nearestDistance = 13 * 13;
  for (let i = 0, offset = 0; i < layer.count; i++, offset += 4) {
    project(
      layer.data[offset],
      layer.data[offset + 1],
      layer.data[offset + 2],
      map.width,
      map.height,
      cam.rotation,
      projected,
    );
    const x = viewportWidth / 2 + (projected[0] - cam.x) * cam.zoom;
    const y = viewportHeight / 2 + (projected[1] - cam.y) * cam.zoom;
    const dx = x - screenX;
    const dy = y - screenY;
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearest = i;
      nearestDistance = distance;
    }
  }
  if (nearest < 0) return null;
  const offset = nearest * 4;
  const x = layer.data[offset];
  const y = layer.data[offset + 1];
  const state = layer.data[offset + 3] >>> 8;
  const tileX = Math.floor(x / TILE_UNITS);
  const tileY = Math.floor(y / TILE_UNITS);
  return `Guest ${nearest + 1}\nTile  ${tileX}, ${tileY}\nState  ${guestState(state)}`;
}

function guestState(state: number): string {
  return ['walking', 'queueing', 'riding', 'leaving'][state] ?? `state ${state}`;
}

let last = performance.now();
let fps = 60;
let renderMs = 0;
function frame(now: number): void {
  const dt = now - last;
  last = now;
  fps = fps * 0.95 + (1000 / Math.max(dt, 1)) * 0.05;
  const pan = (0.6 * dt) / camera.zoom;
  if (keys.has('a')) camera.x -= pan;
  if (keys.has('d')) camera.x += pan;
  if (keys.has('w')) camera.y -= pan;
  if (keys.has('s')) camera.y += pan;
  const renderStart = performance.now();
  renderer.draw(sim.latest, camera);
  renderMs = performance.now() - renderStart;
  hud.update(
    sim.stats,
    fps,
    camera.rotation,
    renderMs,
    renderer.visibleSpriteCount,
    renderer.backend,
  );
  gameUi.update(sim.latest, sim.stats, selectedGuest);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('beforeunload', () => {
  gameUi.dispose();
  renderer.dispose();
});
