import { expect, test } from './support/test';
import type { Page } from '@playwright/test';
import { SAVE_VERSION, deserialize } from '../src/save/save';
import { SceneryCategory, SCENERY_CATALOG } from '../src/sim/map/scenery';
import { ElementType } from '../src/sim/map/tile-map';

test('saves and restores a sandbox when randomUUID is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    });
  });

  await page.goto('/');
  expect(
    await page.evaluate(() => ({ secure: isSecureContext, randomUUID: typeof crypto.randomUUID })),
  ).toEqual({ secure: true, randomUUID: 'undefined' });

  await page.getByRole('button', { name: 'Sandbox', exact: true }).click();
  await expect(page.locator('.hud')).toBeVisible();
  const beforeSave = await readRunningWorld(page);
  const expectedParkData = parkData(beforeSave.world);
  await page.getByRole('button', { name: 'Game options' }).click();
  await page.getByRole('button', { name: 'Save, load and quit…' }).click();

  const slotName = 'Sandbox save persistence test';
  const menu = page.locator('[aria-label="Game menu"]');
  await menu.getByLabel('Save name').fill(slotName);
  await menu.getByRole('button', { name: 'Save to new slot' }).click();
  await expect(menu.locator('.save-message')).toHaveText('Game saved.');
  await expect(menu.locator('.slot-name')).toHaveText(slotName);

  await page.reload();
  await page.getByRole('button', { name: 'Load game', exact: true }).click();
  const savedSlot = page.locator('.slot-row').filter({ hasText: slotName });
  await expect(savedSlot).toBeVisible();
  await savedSlot.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.locator('.title-screen')).toBeHidden();
  await expect(page.locator('.game-toolbar')).toBeVisible();

  const restoredWorld = await readRunningWorld(page);
  expect(parkData(restoredWorld.world)).toEqual(expectedParkData);
  expect(restoredWorld.savedVersion).toBe(SAVE_VERSION);
});

async function readRunningWorld(page: Page) {
  const encodedSave = await page.evaluate(async () => {
    const sim = (window as Window & { __sim?: { save(): Promise<Uint8Array> } }).__sim;
    if (!sim) throw new Error('The running simulation is unavailable after loading the save.');
    const bytes = await sim.save();
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
  });

  const bytes = new Uint8Array(Buffer.from(encodedSave, 'base64'));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(8, 8 + view.getUint32(4, true))),
  ) as { version: number };
  return { world: deserialize(bytes), savedVersion: header.version };
}

function parkData(world: ReturnType<typeof deserialize>) {
  const treeTiles = Array.from(world.map.elType).flatMap((type, element) =>
    type === ElementType.SmallScenery &&
    SCENERY_CATALOG[world.map.elData[element]]?.category === SceneryCategory.Trees
      ? [element]
      : [],
  );

  return {
    entrance: [world.park.entranceX, world.park.entranceY],
    spawns: world.park.spawns,
    treeTiles,
  };
}
