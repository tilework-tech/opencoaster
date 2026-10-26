import { expect, test, type Browser, type Page } from '@playwright/test';
import { openPage, startScenario, toolbarAction } from './support/park';

async function worldPoint(page: Page, tileX: number, tileY: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    async ({ tileX, tileY }) => {
      const { project, pickTile } = await import('/src/render/projection.ts');
      const { TILE_UNITS, Z_STEP } = await import('/src/sim/core/constants.ts');
      const state = window as unknown as {
        __camera: { x: number; y: number; zoom: number; rotation: number };
        __map: { width: number; height: number; heights: Uint8Array; slope: Uint8Array };
      };
      const { __camera: camera, __map: map } = state;
      const world = new Float64Array(2);
      const index = tileY * map.width + tileX;
      project((tileX + 0.5) * TILE_UNITS, (tileY + 0.5) * TILE_UNITS, map.heights[index]! * Z_STEP, map.width, map.height, camera.rotation as 0 | 1 | 2 | 3, world);
      const rect = document.querySelector<HTMLCanvasElement>('#game')!.getBoundingClientRect();
      const x = rect.width / 2 + (world[0]! - camera.x) * camera.zoom;
      const y = rect.height / 2 + (world[1]! - camera.y) * camera.zoom;
      for (let radius = 0; radius <= 24; radius += 2) {
        for (let dy = -radius; dy <= radius; dy += 2) {
          for (let dx = -radius; dx <= radius; dx += 2) {
            const candidateX = x + dx;
            const candidateY = y + dy;
            const selected = pickTile(candidateX, candidateY, map, camera, { width: rect.width, height: rect.height });
            if (selected?.[0] === tileX && selected[1] === tileY) return { x: candidateX, y: candidateY };
          }
        }
      }
      throw new Error(`Could not find screen point for tile ${tileX}, ${tileY}`);
    },
    { tileX, tileY },
  );
}

async function startPage(browser: Browser, mobile: boolean): Promise<Page> {
  if (!mobile) {
    const page = await openPage(browser, false);
    await page.setViewportSize({ width: 1280, height: 800 });
    return page;
  }
  return openPage(browser, true);
}

async function longPressAndDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.locator('#game').evaluate(async (canvas, points) => {
    const send = (type: string, point: { x: number; y: number }) => canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 71, pointerType: 'touch', isPrimary: true, bubbles: true,
      clientX: point.x + canvas.getBoundingClientRect().left,
      clientY: point.y + canvas.getBoundingClientRect().top,
      buttons: type === 'pointerup' ? 0 : 1,
    }));
    send('pointerdown', points.from);
    await new Promise((resolve) => setTimeout(resolve, 950));
    send('pointermove', points.to);
    send('pointerup', points.to);
  }, { from, to });
}

async function tapCanvasAt(page: Page, point: { x: number; y: number }, mobile: boolean): Promise<void> {
  const rect = await page.locator('#game').boundingBox();
  if (!rect) throw new Error('Game canvas is missing');
  const x = rect.x + point.x;
  const y = rect.y + point.y;
  if (mobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

for (const mobile of [false, true]) {
  test(`pick up and reposition a handyman and guest${mobile ? ' on Pixel 8' : ' on desktop'}`, async ({
    browser,
  }) => {
    const page = await startPage(browser, mobile);
    try {
      await startScenario(page, 'Meadowbrook Green');

      await toolbarAction(page, 'Staff');
      const staffPanel = page.locator('[data-panel="staff"]');
      await staffPanel.getByRole('button', { name: 'Hire Handyman' }).click();
      const handyman = staffPanel.locator('.staff-roster li').filter({ hasText: 'Handyman' }).first();
      await expect(handyman).toBeVisible();
      const staffId = Number(await handyman.getAttribute('data-staff-id'));
      await toolbarAction(page, 'Pause');
      const workerButton = staffPanel.locator(`[data-staff-id="${staffId}"]`).getByRole('button', { name: /Open .* details/ });
      await expect(workerButton).toBeVisible();
      await workerButton.click();
      const worker = page.locator('[data-panel^="worker-"]');
      await worker.getByRole('button', { name: 'Pick up' }).click();
      const readStaffPosition = () => page.evaluate((id) => {
        try {
          const state = window as unknown as { __snapshot: { staff: { count: number; data: Int32Array }; staffIds: Int32Array } };
          const snapshot = state.__snapshot;
          let slot = -1;
          for (let i = 0; i < snapshot.staff.count; i++) if (snapshot.staffIds[i] === id) slot = i;
          if (slot < 0 || snapshot.staff.data.buffer.byteLength === 0) return null;
          return { x: Math.floor(snapshot.staff.data[slot * 4]! / 256), y: Math.floor(snapshot.staff.data[slot * 4 + 1]! / 256) };
        } catch { return null; }
      }, staffId);
      await expect.poll(readStaffPosition).not.toBeNull();
      const staffPosition = (await readStaffPosition())!;
      const drop = await page.evaluate(() => {
        const { __map: map } = window as unknown as {
          __map: { width: number; height: number; ownership: Uint8Array; heights: Uint8Array; waterLevel?: Uint8Array };
        };
        for (let y = 4; y < map.height - 4; y++) {
          for (let x = 4; x < map.width - 4; x++) {
            const i = y * map.width + x;
            if ((map.ownership[i]! & 1) !== 0 && (map.waterLevel?.[i] ?? 0) <= map.heights[i]!) return { x, y };
          }
        }
        throw new Error('The scenario has no owned drop tile');
      });
      const dropPoint = await worldPoint(page, drop.x, drop.y);
      const staffPoint = await worldPoint(page, staffPosition.x, staffPosition.y);
      await worker.getByRole('button', { name: /Close/ }).click();
      if (mobile) await longPressAndDrag(page, staffPoint, dropPoint);
      else {
        const canvasBounds = await page.locator('#game').boundingBox();
        if (!canvasBounds) throw new Error('Game canvas is missing');
        await page.mouse.move(canvasBounds.x + staffPoint.x, canvasBounds.y + staffPoint.y);
        await page.mouse.down();
        await page.mouse.move(canvasBounds.x + dropPoint.x, canvasBounds.y + dropPoint.y, { steps: 5 });
        await page.mouse.up();
      }
      await expect.poll(readStaffPosition).toEqual(drop);

      await toolbarAction(page, 'Game options');
      const options = page.locator('[data-panel="options"]');
      await options.getByRole('button', { name: 'Guests +1,000' }).click();
      await toolbarAction(page, 'Resume');
      await expect.poll(() => page.evaluate(() => {
        try {
          const state = window as unknown as { __snapshot: { guests: { count: number; data: Int32Array }; guestIds: Int32Array } };
          const snapshot = state.__snapshot;
          return Array.from(snapshot.guestIds.subarray(0, snapshot.guests.count)).find((id) => id > 0) ?? -1;
        } catch { return -1; }
      }), { timeout: 20_000 }).not.toBe(-1);
      await toolbarAction(page, 'Pause');
      await toolbarAction(page, 'Guests');
      const guestsPanel = page.locator('[data-panel="guests"]');
      await expect(guestsPanel).toBeVisible();
      const guest = await page.evaluate(() => {
        const state = window as unknown as {
          __snapshot: { guests: { count: number; data: Int32Array }; guestIds: Int32Array };
        };
        let slot = -1;
        for (let i = 0; i < state.__snapshot.guests.count; i++) {
          const id = state.__snapshot.guestIds[i]!;
          if (id <= 0) continue;
          slot = i;
          break;
        }
        if (slot < 0) throw new Error('No guest with a selectable id is in the park');
        return {
          id: state.__snapshot.guestIds[slot]!,
          x: Math.floor(state.__snapshot.guests.data[slot * 4]! / 256),
          y: Math.floor(state.__snapshot.guests.data[slot * 4 + 1]! / 256),
        };
      });
      const guestWindow = page.locator(`[data-panel="guest-${guest.id}"]`);
      const readGuestPosition = () => page.evaluate((id) => {
        try {
          const state = window as unknown as { __snapshot: { guests: { count: number; data: Int32Array }; guestIds: Int32Array } };
          const snapshot = state.__snapshot;
          let slot = -1;
          for (let i = 0; i < snapshot.guests.count; i++) if (snapshot.guestIds[i] === id) slot = i;
          if (slot < 0 || snapshot.guests.data.buffer.byteLength === 0) return null;
          return { x: Math.floor(snapshot.guests.data[slot * 4]! / 256), y: Math.floor(snapshot.guests.data[slot * 4 + 1]! / 256) };
        } catch { return null; }
      }, guest.id);
      await guestsPanel.locator(`[data-guest-id="${guest.id}"]`).first().click();
      await expect(guestWindow).toBeVisible();
      await guestWindow.getByRole('button', { name: 'Locate' }).click();
      await guestsPanel.getByRole('button', { name: /Close/ }).click();
      await guestWindow.getByRole('button', { name: 'Pick up' }).click();
      const nextDrop = await page.evaluate(() => {
        const { __map: map } = window as unknown as {
          __map: { width: number; height: number; ownership: Uint8Array; heights: Uint8Array; waterLevel?: Uint8Array };
        };
        for (let y = map.height - 5; y >= 4; y--) {
          for (let x = map.width - 5; x >= 4; x--) {
            const i = y * map.width + x;
            if ((map.ownership[i]! & 1) !== 0 && (map.waterLevel?.[i] ?? 0) <= map.heights[i]!) return { x, y };
          }
        }
        throw new Error('The scenario has no second owned drop tile');
      });
      await tapCanvasAt(page, await worldPoint(page, nextDrop.x, nextDrop.y), mobile);
      await expect.poll(readGuestPosition).toEqual(nextDrop);

      await guestWindow.getByRole('button', { name: 'Pick up' }).click();
      const outside = await page.evaluate(() => {
        const { __map: map } = window as unknown as {
          __map: { width: number; height: number; ownership: Uint8Array };
        };
        for (let y = 4; y < map.height - 4; y++) {
          for (let x = 4; x < map.width - 4; x++) {
            const i = y * map.width + x;
            if ((map.ownership[i]! & 1) === 0) return { x, y };
          }
        }
        throw new Error('The scenario has no unowned drop tile');
      });
      await tapCanvasAt(page, await worldPoint(page, outside.x, outside.y), mobile);
      await expect(page.locator('.tool-status')).toContainText(/owned|invalid/i);
      await expect.poll(readGuestPosition).toEqual(nextDrop);
    } finally {
      await page.context().close();
    }
  });
}
