import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { TILE_UNITS, Z_STEP } from '../src/sim/core/constants';
import { staffPatrolTileEnabled } from '../src/sim/staff/staff-store';
import { project } from '../src/render/projection';
import type { Rotation } from '../src/render/projection';
import { terrainMeshTriangles, terrainTileCorners } from '../src/render/terrain-geometry';
import { savedWorld, startStarterPark, starterWorld, toolbarAction } from '../e2e/support/park';

type Tile = { x: number; y: number };

function nearestTile(
  world: ReturnType<typeof starterWorld>,
  predicate: (tile: Tile) => boolean,
): Tile {
  const { map } = world;
  const candidates: Tile[] = [];
  for (let y = 3; y < map.height - 3; y++) {
    for (let x = 3; x < map.width - 3; x++) {
      if (predicate({ x, y })) candidates.push({ x, y });
    }
  }
  candidates.sort(
    (a, b) => (a.x - 32) ** 2 + (a.y - 32) ** 2 - ((b.x - 32) ** 2 + (b.y - 32) ** 2),
  );
  const tile = candidates[0];
  if (!tile) throw new Error('Starter Park is missing a tile for this patrol scenario');
  return tile;
}

function fullyDryPatrolBlock(world: ReturnType<typeof starterWorld>, tile: Tile): boolean {
  const { map } = world;
  for (let y = (tile.y >>> 2) * 4; y < (tile.y >>> 2) * 4 + 4; y++)
    for (let x = (tile.x >>> 2) * 4; x < (tile.x >>> 2) * 4 + 4; x++)
      if ((map.waterLevel?.[map.index(x, y)] ?? 0) > 0) return false;
  return true;
}

function patrolBlockHasMultipleSlopes(world: ReturnType<typeof starterWorld>, tile: Tile): boolean {
  let slopedTiles = 0;
  for (let y = (tile.y >>> 2) * 4; y < (tile.y >>> 2) * 4 + 4; y++)
    for (let x = (tile.x >>> 2) * 4; x < (tile.x >>> 2) * 4 + 4; x++)
      if (world.map.slope[world.map.index(x, y)] !== 0) slopedTiles++;
  return slopedTiles >= 2;
}

function patrolBlockIsFlat(world: ReturnType<typeof starterWorld>, tile: Tile): boolean {
  const firstHeight = world.map.heights[world.map.index((tile.x >>> 2) * 4, (tile.y >>> 2) * 4)];
  for (const point of patrolBlockTiles(tile)) {
    const index = world.map.index(point.x, point.y);
    if (world.map.slope[index] !== 0 || world.map.heights[index] !== firstHeight) return false;
  }
  return true;
}

function patrolBlockTiles(tile: Tile): Tile[] {
  const tiles: Tile[] = [];
  for (let y = (tile.y >>> 2) * 4; y < (tile.y >>> 2) * 4 + 4; y++)
    for (let x = (tile.x >>> 2) * 4; x < (tile.x >>> 2) * 4 + 4; x++) tiles.push({ x, y });
  return tiles;
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

async function aimAtTile(
  page: Page,
  world: ReturnType<typeof starterWorld>,
  tile: Tile,
  rotation: Rotation,
  zoom: number,
) {
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
      const camera = (
        window as unknown as {
          __camera: { x: number; y: number; zoom: number; rotation: Rotation };
        }
      ).__camera;
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

async function captureRotationMatrix(
  page: Page,
  world: ReturnType<typeof starterWorld>,
  tile: Tile,
  scene: 'hilly' | 'flat',
): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Browser viewport is missing');
  const zoom = viewport.width < 600 ? 0.72 : 2;
  const backend = test.info().project.name;
  for (const rotation of [0, 1, 2, 3] as Rotation[]) {
    const point = await aimAtTile(page, world, tile, rotation, zoom);
    await page.mouse.move(...point);
    await page.waitForTimeout(100);
    const windows = await page.addStyleTag({
      content: '.ui-windows { visibility: hidden !important; }',
    });
    const path = `.local/pr-proof/patrol-${scene}-${backend}-rotation-${rotation}.png`;
    await page.screenshot({ path });
    if (scene === 'hilly' && rotation === 0)
      await page.screenshot({ path: '.local/pr-proof/patrol-after-hilly.png' });
    if (scene === 'flat' && rotation === 0)
      await page.screenshot({ path: '.local/pr-proof/patrol-after-flat.png' });
    await windows.evaluate((style) => style.remove());
  }
}

test('paints separate staff patrol blocks on hills through the worker windows', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await startStarterPark(page);
  const world = starterWorld();
  const hill = nearestTile(
    world,
    (tile) =>
      world.map.slope[world.map.index(tile.x, tile.y)] !== 0 &&
      fullyDryPatrolBlock(world, tile) &&
      patrolBlockHasMultipleSlopes(world, tile),
  );
  const flat = nearestTile(
    world,
    ({ x, y }) =>
      world.map.slope[world.map.index(x, y)] === 0 &&
      fullyDryPatrolBlock(world, { x, y }) &&
      patrolBlockIsFlat(world, { x, y }) &&
      (x >> 2 !== hill.x >> 2 || y >> 2 !== hill.y >> 2),
  );
  const nextBlock = nearestTile(
    world,
    (tile) =>
      tile.x >> 2 === hill.x >> 2 &&
      tile.y >> 2 === hill.y >> 2 &&
      (tile.x !== hill.x || tile.y !== hill.y) &&
      world.map.slope[world.map.index(tile.x, tile.y)] !== 0 &&
      fullyDryPatrolBlock(world, tile),
  );
  expect((flat.x >> 2) * 1_000 + (flat.y >> 2)).not.toBe((hill.x >> 2) * 1_000 + (hill.y >> 2));

  await toolbarAction(page, 'Staff');
  const staff = page.locator('[data-panel="staff"]');
  await staff.getByRole('button', { name: 'Hire Handyman' }).click();
  await staff.getByRole('button', { name: 'Hire Handyman' }).click();
  const rows = staff.locator('[data-staff-id]');
  await expect(rows).toHaveCount(2);
  const firstId = Number(await rows.nth(0).getAttribute('data-staff-id'));
  const secondId = Number(await rows.nth(1).getAttribute('data-staff-id'));
  const firstName = await rows.nth(0).innerText();
  const secondName = await rows.nth(1).innerText();

  await rows
    .nth(0)
    .getByRole('button', { name: new RegExp(`Open ${firstName.split(' ·')[0]} details`) })
    .click();
  let worker = page.locator(`[data-panel="worker-${firstId}"]`);
  await worker.getByRole('tab', { name: 'Orders' }).click();
  await worker.getByRole('button', { name: /Edit .*patrol area/ }).click();
  await expect(page.locator('.tool-status')).toContainText(
    `Patrol tool selected for worker ${firstId}`,
  );

  const hillBeforeDrag = await aimAtTile(page, world, hill, 0, 2);
  await page.mouse.click(...hillBeforeDrag);
  await expect(page.locator('.tool-status')).toContainText('Patrol tile added');
  await page.waitForTimeout(500);
  await mkdir('.local/pr-proof', { recursive: true });
  await captureRotationMatrix(page, world, hill, 'hilly');

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

  await worker.getByRole('button', { name: 'Close Worker' }).click();
  if (!(await staff.isVisible())) {
    await toolbarAction(page, 'Staff');
    await expect(staff).toBeVisible();
  }
  await rows
    .nth(1)
    .getByRole('button', { name: new RegExp(`Open ${secondName.split(' ·')[0]} details`) })
    .click();
  worker = page.locator(`[data-panel="worker-${secondId}"]`);
  await worker.getByRole('tab', { name: 'Orders' }).click();
  await worker.getByRole('button', { name: /Edit .*patrol area/ }).click();
  await expect(page.locator('.tool-status')).toContainText(
    `Patrol tool selected for worker ${secondId}`,
  );
  const flatAt = await aimAtTile(page, world, flat, 2, 1.25);
  await page.mouse.click(...flatAt);
  await page.waitForTimeout(500);
  await captureRotationMatrix(page, world, flat, 'flat');
  const removeAt = await aimAtTile(page, world, flat, 2, 1.25);
  await page.keyboard.down('Shift');
  await page.mouse.click(...removeAt);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(200);
  const restoreFlatAt = await aimAtTile(page, world, flat, 2, 1.25);
  await page.mouse.click(...restoreFlatAt);

  const saved = await savedWorld(page);
  for (const tile of patrolBlockTiles(hill)) {
    expect(staffPatrolTileEnabled(saved, firstId, tile.x, tile.y)).toBe(true);
    expect(staffPatrolTileEnabled(saved, secondId, tile.x, tile.y)).toBe(false);
  }
  for (const tile of patrolBlockTiles(flat)) {
    expect(staffPatrolTileEnabled(saved, firstId, tile.x, tile.y)).toBe(false);
    expect(staffPatrolTileEnabled(saved, secondId, tile.x, tile.y)).toBe(true);
  }
});
