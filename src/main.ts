import { SimClient } from './worker/sim-client';
import { Canvas2DRenderer } from './render/canvas2d-renderer';
import type { Camera, Renderer } from './render/renderer';
import type { Rotation } from './render/projection';
import { Hud } from './ui/hud';
import { DEFAULT_MAP_SIZE } from './sim/core/constants';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const root = document.getElementById('app') as HTMLElement;

const sim = new SimClient({
  seed: 1,
  width: DEFAULT_MAP_SIZE,
  height: DEFAULT_MAP_SIZE,
  initialGuests: 1000,
});
const renderer: Renderer = new Canvas2DRenderer();
renderer.attach(canvas);
sim.onMap = (m) => renderer.setMap(m);

const camera: Camera = { x: 0, y: (DEFAULT_MAP_SIZE * 32) / 2, zoom: 1, rotation: 0 };
const hud = new Hud(root);
let paused = false;

function resize(): void {
  renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
}
window.addEventListener('resize', resize);
resize();

const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key === 'q') camera.rotation = ((camera.rotation + 3) % 4) as Rotation;
  if (e.key === 'e') camera.rotation = ((camera.rotation + 1) % 4) as Rotation;
  if (e.key === 'g') sim.command({ type: 'spawnGuests', count: 1000 });
  if (e.key === ' ') sim.setPaused((paused = !paused));
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('wheel', (e) => {
  camera.zoom = Math.max(0.25, Math.min(4, camera.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
});
let drag = false;
canvas.addEventListener('pointerdown', () => (drag = true));
window.addEventListener('pointerup', () => (drag = false));
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  camera.x -= e.movementX / camera.zoom;
  camera.y -= e.movementY / camera.zoom;
});

let last = performance.now();
let fps = 60;
function frame(now: number): void {
  const dt = now - last;
  last = now;
  fps = fps * 0.95 + (1000 / Math.max(dt, 1)) * 0.05;
  const pan = (0.6 * dt) / camera.zoom;
  if (keys.has('a')) camera.x -= pan;
  if (keys.has('d')) camera.x += pan;
  if (keys.has('w')) camera.y -= pan;
  if (keys.has('s')) camera.y += pan;
  renderer.draw(sim.latest, camera);
  hud.update(sim.stats, fps, camera.rotation);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
