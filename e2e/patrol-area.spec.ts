import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { TILE_UNITS, Z_STEP } from '../src/sim/core/constants';
import { staffPatrolTileEnabled } from '../src/sim/staff/staff-store';
import { project } from '../src/render/projection';
import type { Rotation } from '../src/render/projection';
import { terrainMeshTriangles, terrainTileCorners } from '../src/render/terrain-geometry';
import { savedWorld, startStarterPark, starterWorld } from './support/park';

type Tile = { x: number; y: number };

function nearestTile(world: ReturnType<typeof starterWorld>, predicate: (tile: Tile) => boolean): Tile {
  const { map } = world;
  const candidates: Tile[] = [];
  for (let y = 3; y < map.height - 3; y++) {
    for (let x = 3; x < map.width - 3; x++) {
      if (predicate({ x, y })) candidates.push({ x, y });
    }
  }
  candidates.sort(
    (a, b) =>
      (a.x - 32) ** 2 + (a.y - 32) ** 2 - ((b.x - 32) ** 2 + (b.y - 32) ** 2),
  );
  const tile = candidates[0];
  if (!tile) throw new Error('Starter Park is missing a tile for this patrol scenario');
  return tile;
}

function screenPoint(
  world: ReturnType<typeof starterWorld>,
  tile: Tile,
  rotation: Rotation,
  zoom: number,
  canvas: { x: number; y: number; width: number; height: number },
  camera: { x: number; y: number },
): [number, number] {
  const { map } = world;
  const index = map.index(tile.x, tile.y);
  const corners = terrainTileCorners(tile.x, tile.y, map.heights[index]!, map.slope[index]!);
  const triangle = terrainMeshTriangles(rotation)[0];
  const weights = [0.4, 0.3, 0.3];
  const fx = triangle.reduce((sum, corner, i) => sum + corners[corner]!.x * weights[i]!, 0);
  const fy = triangle.reduce((sum, corner, i) => sum + corners[corner]!.y * weights[i]!, 0);
  const fz = triangle.reduce(
    (sum, corner, i) => sum + corners[corner]!.height * Z_STEP * weights[i]!,
    0,
  );
  const projected = new Float64Array(2);
  project(fx * TILE_UNITS, fy * TILE_UNITS, fz, map.width, map.height, rotation, projected);
  return [
    canvas.x + canvas.width / 2 + (projected[0] - camera.x) * zoom,
    canvas.y + canvas.height / 2 + (projected[1] - camera.y) * zoom,
  ];
}

async function aimAtTile(page: Page, world: ReturnType<typeof starterWorld>, tile: Tile, rotation: Rotation, zoom: number) {
  const canvas = await page.locator('#game').boundingBox();
  if (!canvas) throw new Error('Game canvas is not visible');
  const map = world.map;
  const index = map.index(tile.x, tile.y);
  const corners = terrainTileCorners(tile.x, tile.y, map.heights[index]!, map.slope[index]!);
  const triangle = terrainMeshTriangles(rotation)[0];
  const weights = [0.4, 0.3, 0.3];
  const fx = triangle.reduce((sum, corner, i) => sum + corners[corner]!.x * weights[i]!, 0);
  const fy = triangle.reduce((sum, corner, i) => sum + corners[corner]!.y * weights[i]!, 0);
  const fz = triangle.reduce(
    (sum, corner, i) => sum + corners[corner]!.height * Z_STEP * weights[i]!,
    0,
  );
  const projected = new Float64Array(2);
  project(fx * TILE_UNITS, fy * TILE_UNITS, fz, map.width, map.height, rotation, projected);
  await page.evaluate(
    ({ x, y, zoom, rotation }) => {
      const camera = (window as unknown as { __camera: { x: number; y: number; zoom: number; rotation: Rotation } }).__camera;
      camera.x = x;
      camera.y = y;
      camera.zoom = zoom;
      camera.rotation = rotation;
    },
    { x: projected[0], y: projected[1], zoom, rotation },
  );
  const camera = { x: projected[0], y: projected[1] };
  const at = screenPoint(world, tile, rotation, zoom, canvas, camera);
  await page.waitForTimeout(100);
  return at;
}

test('paints separate staff patrol blocks on hills through the worker windows', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await startStarterPark(page);
  const world = starterWorld();
  const flat = nearestTile(world, ({ x, y }) => world.map.slope[world.map.index(x, y)] === 0);
  const hill = nearestTile(world, ({ x, y }) => world.map.slope[world.map.index(x, y)] !== 0);
  const nextBlock = nearestTile(
    world,
    ({ x, y }) => (x >> 2) !== (hill.x >> 2) && world.map.slope[world.map.index(x, y)] !== 0,
  );
  expect((flat.x >> 2) * 1_000 + (flat.y >> 2)).not.toBe(
    (hill.x >> 2) * 1_000 + (hill.y >> 2),
  );
  expect((nextBlock.x >> 2) * 1_000 + (nextBlock.y >> 2)).not.toBe(
    (hill.x >> 2) * 1_000 + (hill.y >> 2),
  );

  const toolbar = page.locator('.game-toolbar');
  await toolbar.getByRole('button', { name: 'Staff', exact: true }).click();
  const staff = page.locator('[data-panel="staff"]');
  await staff.getByRole('button', { name: 'Hire Handyman' }).click();
  await staff.getByRole('button', { name: 'Hire Handyman' }).click();
  const rows = staff.locator('[data-staff-id]');
  await expect(rows).toHaveCount(2);
  const firstId = Number(await rows.nth(0).getAttribute('data-staff-id'));
  const secondId = Number(await rows.nth(1).getAttribute('data-staff-id'));
  const firstName = await rows.nth(0).innerText();
  const secondName = await rows.nth(1).innerText();

  await rows.nth(0).getByRole('button', { name: new RegExp(`Open ${firstName.split(' ·')[0]} details`) }).click();
  let worker = page.locator(`[data-panel="worker-${firstId}"]`);
  await worker.getByRole('tab', { name: 'Orders' }).click();
  await worker.getByRole('button', { name: /Edit .*patrol area/ }).click();
  await expect(page.locator('.tool-status')).toContainText('Patrol tool selected');

  const hillBeforeDrag = await aimAtTile(page, world, hill, 0, 0.75);
  await page.mouse.click(...hillBeforeDrag);
  await expect(page.locator('.tool-status')).toContainText('Patrol tile added');
  await mkdir('.local/pr-proof', { recursive: true });
  await page.screenshot({ path: '.local/pr-proof/patrol-after-hilly.png' });

  for (const rotation of [0, 1, 2, 3] as Rotation[]) {
    const zoom = rotation % 2 === 0 ? 0.75 : 1.5;
    const at = await aimAtTile(page, world, hill, rotation, zoom);
    await page.mouse.click(...at);
  }
  const hillDragStart = await aimAtTile(page, world, hill, 0, 1);
  const camera = await page.evaluate(() => {
    const value = (window as unknown as { __camera: { x: number; y: number } }).__camera;
    return { x: value.x, y: value.y };
  });
  const canvas = await page.locator('#game').boundingBox();
  if (!canvas) throw new Error('Game canvas is not visible');
  const hillDragEnd = screenPoint(world, nextBlock, 0, 1, canvas, camera);
  await page.mouse.move(...hillDragStart);
  await page.mouse.down();
  await page.mouse.move(...hillDragEnd, { steps: 12 });
  await page.mouse.up();

  await rows.nth(1).getByRole('button', { name: new RegExp(`Open ${secondName.split(' ·')[0]} details`) }).click();
  worker = page.locator(`[data-panel="worker-${secondId}"]`);
  await worker.getByRole('tab', { name: 'Orders' }).click();
  await worker.getByRole('button', { name: /Edit .*patrol area/ }).click();
  const flatAt = await aimAtTile(page, world, flat, 2, 1.25);
  await page.mouse.click(...flatAt);
  await page.screenshot({ path: '.local/pr-proof/patrol-after-flat.png' });

  await rows.nth(0).getByRole('button', { name: new RegExp(`Open ${firstName.split(' ·')[0]} details`) }).click();
  worker = page.locator(`[data-panel="worker-${firstId}"]`);
  await worker.getByRole('tab', { name: 'Orders' }).click();
  await worker.getByRole('button', { name: /Edit .*patrol area/ }).click();
  const removeAt = await aimAtTile(page, world, nextBlock, 3, 1);
  await page.keyboard.down('Shift');
  await page.mouse.click(...removeAt);
  await page.keyboard.up('Shift');
  await worker.getByRole('button', { name: 'Remove tiles' }).click();
  const removeHillAt = await aimAtTile(page, world, hill, 1, 0.75);
  await page.mouse.click(...removeHillAt);
  await worker.getByRole('button', { name: 'Remove tiles' }).click();
  const restoreHillAt = await aimAtTile(page, world, hill, 0, 1);
  await page.mouse.click(...restoreHillAt);

  const saved = await savedWorld(page);
  expect(staffPatrolTileEnabled(saved, firstId, hill.x, hill.y)).toBe(true);
  expect(staffPatrolTileEnabled(saved, firstId, nextBlock.x, nextBlock.y)).toBe(false);
  expect(staffPatrolTileEnabled(saved, firstId, flat.x, flat.y)).toBe(false);
  expect(staffPatrolTileEnabled(saved, secondId, flat.x, flat.y)).toBe(true);
  expect(staffPatrolTileEnabled(saved, secondId, hill.x, hill.y)).toBe(false);
});
