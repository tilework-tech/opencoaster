import { expect, test, type Browser, type Page, type TestInfo } from './support/test';
import { openPage, startScenario, toolbarAction } from './support/park';

async function worldPoint(
  page: Page,
  tileX: number,
  tileY: number,
): Promise<{ x: number; y: number }> {
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
      project(
        (tileX + 0.5) * TILE_UNITS,
        (tileY + 0.5) * TILE_UNITS,
        map.heights[index]! * Z_STEP,
        map.width,
        map.height,
        camera.rotation as 0 | 1 | 2 | 3,
        world,
      );
      const rect = document.querySelector<HTMLCanvasElement>('#game')!.getBoundingClientRect();
      const x = rect.width / 2 + (world[0]! - camera.x) * camera.zoom;
      const y = rect.height / 2 + (world[1]! - camera.y) * camera.zoom;
      for (let radius = 0; radius <= 24; radius += 2) {
        for (let dy = -radius; dy <= radius; dy += 2) {
          for (let dx = -radius; dx <= radius; dx += 2) {
            const candidateX = x + dx;
            const candidateY = y + dy;
            const selected = pickTile(candidateX, candidateY, map, camera, {
              width: rect.width,
              height: rect.height,
            });
            if (selected?.[0] === tileX && selected[1] === tileY)
              return { x: candidateX, y: candidateY };
          }
        }
      }
      throw new Error(`Could not find screen point for tile ${tileX}, ${tileY}`);
    },
    { tileX, tileY },
  );
}

async function visibleStaffSpritePoint(
  page: Page,
  staffId: number,
): Promise<{ x: number; y: number }> {
  return page.locator('#game').evaluate(async (canvas, staffId) => {
    const [{ buildObjectPickTargets, pickTopmostObject }, { spritePages }] = await Promise.all([
      import('/src/input/object-picking.ts'),
      import('/src/render/sprite-pages.ts'),
    ]);
    const state = window as unknown as {
      __camera: Parameters<typeof buildObjectPickTargets>[2];
      __map: Parameters<typeof buildObjectPickTargets>[1];
      __snapshot: Parameters<typeof buildObjectPickTargets>[0];
    };
    const { __camera: camera, __map: map, __snapshot: snapshot } = state;
    if (!snapshot) throw new Error('The park snapshot is not ready');
    const rect = canvas.getBoundingClientRect();
    const targets = buildObjectPickTargets(
      snapshot,
      map,
      camera,
      { width: rect.width, height: rect.height },
      spritePages,
    );
    for (const target of targets) {
      if (target.kind !== 'staff' || target.personId !== staffId) continue;
      for (let pixel = 0; pixel < target.alpha.length; pixel++) {
        if (target.alpha[pixel] === 0) continue;
        const x =
          target.x + (((pixel % target.alphaWidth) + 0.5) / target.alphaWidth) * target.width;
        const y =
          target.y +
          ((Math.floor(pixel / target.alphaWidth) + 0.5) / target.alphaHeight) * target.height;
        if (pickTopmostObject(targets, x, y)?.id !== target.id) continue;
        return { x: rect.left + x, y: rect.top + y };
      }
    }
    throw new Error(`Handyman ${staffId} has no visible sprite pixel`);
  }, staffId);
}

async function startPage(
  browser: Browser,
  mobile: boolean,
  backend: 'WebGL2' | 'Canvas2D',
): Promise<Page> {
  const contextBrowser =
    backend === 'Canvas2D'
      ? await browser.browserType().launch({ args: ['--disable-webgl'] })
      : browser;
  if (!mobile) {
    const page = await openPage(contextBrowser, false);
    await page.setViewportSize({ width: 1280, height: 800 });
    return page;
  }
  return openPage(contextBrowser, true);
}

async function longPressStart(page: Page, from: { x: number; y: number }) {
  await page.locator('#game').evaluate(
    async (canvas, points) => {
      if (!Object.hasOwn(canvas, 'setPointerCapture'))
        Object.defineProperty(canvas, 'setPointerCapture', { value: () => {} });
      const send = (type: string, point: { x: number; y: number }, buttons = 1) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 71,
            pointerType: 'touch',
            isPrimary: true,
            bubbles: true,
            clientX: point.x + canvas.getBoundingClientRect().left,
            clientY: point.y + canvas.getBoundingClientRect().top,
            buttons,
          }),
        );
      send('pointerdown', points.from);
      await new Promise((resolve) => setTimeout(resolve, 950));
    },
    { from },
  );
}

async function touchMove(page: Page, point: { x: number; y: number }, end = false) {
  await page.locator('#game').evaluate(
    (canvas, state) => {
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new PointerEvent(state.end ? 'pointerup' : 'pointermove', {
          pointerId: 71,
          pointerType: 'touch',
          isPrimary: true,
          bubbles: true,
          clientX: rect.left + state.point.x,
          clientY: rect.top + state.point.y,
          buttons: state.end ? 0 : 1,
        }),
      );
    },
    { point, end },
  );
}

async function tapCanvasAt(
  page: Page,
  point: { x: number; y: number },
  mobile: boolean,
): Promise<void> {
  const rect = await page.locator('#game').boundingBox();
  if (!rect) throw new Error('Game canvas is missing');
  const x = rect.x + point.x;
  const y = rect.y + point.y;
  if (mobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function visibleUnownedTile(page: Page): Promise<{
  x: number;
  y: number;
  point: { x: number; y: number };
}> {
  return page.evaluate(async () => {
    const { project } = await import('/src/render/projection.ts');
    const { TILE_UNITS, Z_STEP } = await import('/src/sim/core/constants.ts');
    const { __map: map, __camera: camera } = window as unknown as {
      __map: {
        width: number;
        height: number;
        ownership: Uint8Array;
        heights: Uint8Array;
        pathCount: number;
        pathElements: Int32Array;
      };
      __camera: { x: number; y: number; zoom: number; rotation: number };
    };
    const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
    const rect = canvas.getBoundingClientRect();
    const world = new Float64Array(2);
    for (let y = 4; y < map.height - 4; y++) {
      for (let x = 4; x < map.width - 4; x++) {
        const index = y * map.width + x;
        if ((map.ownership[index]! & 1) !== 0) continue;
        let hasPath = false;
        for (let path = 0; path < map.pathCount; path++) {
          const offset = path * 6;
          if (map.pathElements[offset] === x && map.pathElements[offset + 1] === y) {
            hasPath = true;
            break;
          }
        }
        if (hasPath) continue;
        project(
          (x + 0.5) * TILE_UNITS,
          (y + 0.5) * TILE_UNITS,
          map.heights[index]! * Z_STEP,
          map.width,
          map.height,
          camera.rotation as 0 | 1 | 2 | 3,
          world,
        );
        const point = {
          x: rect.width / 2 + (world[0]! - camera.x) * camera.zoom,
          y: rect.height / 2 + (world[1]! - camera.y) * camera.zoom,
        };
        if (
          point.x < 24 ||
          point.x > rect.width - 24 ||
          point.y < 210 ||
          point.y > rect.height - 240
        )
          continue;
        if (document.elementFromPoint(rect.left + point.x, rect.top + point.y) !== canvas) continue;
        return { x, y, point };
      }
    }
    throw new Error('The scenario has no visible unowned drop tile');
  });
}

for (const backend of ['WebGL2', 'Canvas2D'] as const) {
  for (const mobile of [false, true]) {
    test(`pick up and reposition a handyman and guest in ${backend}${mobile ? ' on Pixel 8' : ' on desktop'}`, async ({
      browser,
    }, testInfo: TestInfo) => {
      const page = await startPage(browser, mobile, backend);
      try {
        await startScenario(page, 'Meadowbrook Green');
        await expect(page.locator('.hud')).toContainText(backend);

        await toolbarAction(page, 'Staff');
        const staffPanel = page.locator('[data-panel="staff"]');
        await staffPanel.getByRole('button', { name: 'Hire Handyman' }).click();
        const handyman = staffPanel
          .locator('.staff-roster li')
          .filter({ hasText: 'Handyman' })
          .first();
        await expect(handyman).toBeVisible();
        const staffId = Number(await handyman.getAttribute('data-staff-id'));
        await toolbarAction(page, 'Pause');
        if (mobile) {
          await toolbarAction(page, 'Zoom out');
          await toolbarAction(page, 'Zoom out');
        }
        const workerButton = staffPanel
          .locator(`[data-staff-id="${staffId}"]`)
          .getByRole('button', { name: /Open .* details/ });
        await expect(workerButton).toBeVisible();
        await workerButton.click();
        const worker = page.locator('[data-panel^="worker-"]');
        await worker.getByRole('button', { name: 'Pick up' }).click();
        const readStaffPosition = () =>
          page.evaluate((id) => {
            try {
              const state = window as unknown as {
                __snapshot: { staff: { count: number; data: Int32Array }; staffIds: Int32Array };
              };
              const snapshot = state.__snapshot;
              let slot = -1;
              for (let i = 0; i < snapshot.staff.count; i++)
                if (snapshot.staffIds[i] === id) slot = i;
              if (slot < 0 || snapshot.staff.data.buffer.byteLength === 0) return null;
              return {
                x: Math.floor(snapshot.staff.data[slot * 4]! / 256),
                y: Math.floor(snapshot.staff.data[slot * 4 + 1]! / 256),
              };
            } catch {
              return null;
            }
          }, staffId);
        await expect.poll(readStaffPosition).not.toBeNull();
        const drop = await page.evaluate(async (mobile) => {
          const { project, pickTile } = await import('/src/render/projection.ts');
          const { TILE_UNITS, Z_STEP } = await import('/src/sim/core/constants.ts');
          const { __map: map } = window as unknown as {
            __map: {
              width: number;
              height: number;
              ownership: Uint8Array;
              heights: Uint8Array;
              waterLevel?: Uint8Array;
            };
            __camera: { x: number; y: number; zoom: number; rotation: number };
          };
          const { __camera: camera } = window as unknown as {
            __camera: { x: number; y: number; zoom: number; rotation: number };
          };
          const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
          const rect = canvas.getBoundingClientRect();
          const world = new Float64Array(2);
          let best: { x: number; y: number; distance: number } | null = null;
          for (let y = 4; y < map.height - 4; y++) {
            for (let x = 4; x < map.width - 4; x++) {
              const i = y * map.width + x;
              if ((map.ownership[i]! & 1) === 0 || (map.waterLevel?.[i] ?? 0) > map.heights[i]!)
                continue;
              project(
                (x + 0.5) * TILE_UNITS,
                (y + 0.5) * TILE_UNITS,
                map.heights[i]! * Z_STEP,
                map.width,
                map.height,
                camera.rotation as 0 | 1 | 2 | 3,
                world,
              );
              const point = {
                x: rect.width / 2 + (world[0]! - camera.x) * camera.zoom,
                y: rect.height / 2 + (world[1]! - camera.y) * camera.zoom,
              };
              if (
                point.x < 30 ||
                point.x > rect.width - 30 ||
                point.y < (mobile ? 210 : 50) ||
                point.y > rect.height - (mobile ? 240 : 50)
              )
                continue;
              if (document.elementFromPoint(rect.left + point.x, rect.top + point.y) !== canvas)
                continue;
              const tile = pickTile(point.x, point.y, map, camera, {
                width: rect.width,
                height: rect.height,
              });
              if (tile?.[0] !== x || tile[1] !== y) continue;
              const distance = (point.x - rect.width / 2) ** 2 + (point.y - rect.height / 2) ** 2;
              if (!best || distance < best.distance) best = { x, y, distance };
            }
          }
          if (!best) throw new Error('The scenario has no visible owned drop tile');
          return { x: best.x, y: best.y };
        }, mobile);
        const dropPoint = await worldPoint(page, drop.x, drop.y);
        const staffSpritePoint = await visibleStaffSpritePoint(page, staffId);
        const invalidPoint = await visibleUnownedTile(page);
        await worker.getByRole('button', { name: /Close/ }).click();
        if (mobile) {
          await longPressStart(page, staffSpritePoint);
          await touchMove(page, invalidPoint.point);
          await expect(page.locator('.person-drop-marker')).toHaveAttribute('data-valid', 'false');
          await expect(page.locator('.person-drop-marker')).toBeVisible();
          await expect(page.locator('.tool-status')).toContainText(/owned|path/i);
          await page.screenshot({ path: testInfo.outputPath('pickup-invalid.png') });
          await touchMove(page, dropPoint);
          await expect(page.locator('.person-pickup-ghost')).toBeVisible();
          await expect(page.locator('.person-drop-shadow')).toBeVisible();
          await expect(page.locator('.person-drop-marker')).toHaveAttribute('data-valid', 'true');
          await page.screenshot({ path: testInfo.outputPath('pickup-valid.png') });
          await touchMove(page, dropPoint, true);
        } else {
          const canvasBounds = await page.locator('#game').boundingBox();
          if (!canvasBounds) throw new Error('Game canvas is missing');
          await page.mouse.move(
            canvasBounds.x + staffSpritePoint.x,
            canvasBounds.y + staffSpritePoint.y,
          );
          await page.mouse.down();
          await page.mouse.move(
            canvasBounds.x + invalidPoint.point.x,
            canvasBounds.y + invalidPoint.point.y,
            { steps: 3 },
          );
          await expect(page.locator('.person-drop-marker')).toHaveAttribute('data-valid', 'false');
          await expect(page.locator('.person-drop-marker')).toBeVisible();
          await expect(page.locator('.tool-status')).toContainText(/owned|path/i);
          await page.screenshot({ path: testInfo.outputPath('pickup-invalid.png') });
          await page.mouse.move(canvasBounds.x + dropPoint.x, canvasBounds.y + dropPoint.y, {
            steps: 5,
          });
          await expect(page.locator('.person-pickup-ghost')).toBeVisible();
          await expect(page.locator('.person-drop-shadow')).toBeVisible();
          await expect(page.locator('.person-drop-marker')).toHaveAttribute('data-valid', 'true');
          await page.screenshot({ path: testInfo.outputPath('pickup-valid.png') });
          await page.mouse.up();
        }
        await expect.poll(readStaffPosition).toEqual(drop);

        await toolbarAction(page, 'Game options');
        const options = page.locator('[data-panel="options"]');
        await options.getByRole('button', { name: 'Guests +1,000' }).click();
        await toolbarAction(page, 'Resume');
        await expect
          .poll(
            () =>
              page.evaluate(() => {
                try {
                  const state = window as unknown as {
                    __snapshot: {
                      guests: { count: number; data: Int32Array };
                      guestIds: Int32Array;
                    };
                  };
                  const snapshot = state.__snapshot;
                  return (
                    Array.from(snapshot.guestIds.subarray(0, snapshot.guests.count)).find(
                      (id) => id > 0,
                    ) ?? -1
                  );
                } catch {
                  return -1;
                }
              }),
            { timeout: 20_000 },
          )
          .not.toBe(-1);
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
        const walkingGuestHeight = await page.evaluate(async (guestId) => {
          const [{ buildObjectPickTargets }, { spritePages }] = await Promise.all([
            import('/src/input/object-picking.ts'),
            import('/src/render/sprite-pages.ts'),
          ]);
          const state = window as unknown as {
            __camera: Parameters<typeof buildObjectPickTargets>[2];
            __map: Parameters<typeof buildObjectPickTargets>[1];
            __snapshot: Parameters<typeof buildObjectPickTargets>[0];
          };
          const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
          const targets = buildObjectPickTargets(
            state.__snapshot,
            state.__map,
            state.__camera,
            { width: canvas.clientWidth, height: canvas.clientHeight },
            spritePages,
          );
          const target = targets.find(
            (candidate) => candidate.kind === 'guest' && candidate.personId === guestId,
          );
          if (!target) throw new Error('Picked guest does not have a walking sprite target');
          return target.height;
        }, guest.id);
        const guestWindow = page.locator(`[data-panel="guest-${guest.id}"]`);
        const readGuestPosition = () =>
          page.evaluate((id) => {
            try {
              const state = window as unknown as {
                __snapshot: { guests: { count: number; data: Int32Array }; guestIds: Int32Array };
              };
              const snapshot = state.__snapshot;
              let slot = -1;
              for (let i = 0; i < snapshot.guests.count; i++)
                if (snapshot.guestIds[i] === id) slot = i;
              if (slot < 0 || snapshot.guests.data.buffer.byteLength === 0) return null;
              return {
                x: Math.floor(snapshot.guests.data[slot * 4]! / 256),
                y: Math.floor(snapshot.guests.data[slot * 4 + 1]! / 256),
              };
            } catch {
              return null;
            }
          }, guest.id);
        await guestsPanel.locator(`[data-guest-id="${guest.id}"]`).first().click();
        await expect(guestWindow).toBeVisible();
        await guestWindow.getByRole('tab', { name: 'View' }).click();
        const pickUpGuest = guestWindow.getByRole('button', { name: 'Pick up' });
        await pickUpGuest.scrollIntoViewIfNeeded();
        await pickUpGuest.click();
        const nextDrop = await page.evaluate(async (guestPosition) => {
          const { project, pickTile } = await import('/src/render/projection.ts');
          const { TILE_UNITS, Z_STEP } = await import('/src/sim/core/constants.ts');
          const state = window as unknown as {
            __camera: { x: number; y: number; zoom: number; rotation: number };
            __map: {
              width: number;
              height: number;
              ownership: Uint8Array;
              heights: Uint8Array;
              slope: Uint8Array;
              waterLevel?: Uint8Array;
            };
          };
          const { __map: map, __camera: camera } = state;
          const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
          const rect = canvas.getBoundingClientRect();
          const world = new Float64Array(2);
          for (let distance = 2; distance < Math.max(map.width, map.height); distance++) {
            for (let y = 4; y < map.height - 4; y++) {
              for (let x = 4; x < map.width - 4; x++) {
                if (Math.abs(x - guestPosition.x) + Math.abs(y - guestPosition.y) < distance)
                  continue;
                const index = y * map.width + x;
                if (
                  (map.ownership[index]! & 1) === 0 ||
                  (map.waterLevel?.[index] ?? 0) > map.heights[index]!
                )
                  continue;
                project(
                  (x + 0.5) * TILE_UNITS,
                  (y + 0.5) * TILE_UNITS,
                  map.heights[index]! * Z_STEP,
                  map.width,
                  map.height,
                  camera.rotation as 0 | 1 | 2 | 3,
                  world,
                );
                const point = {
                  x: rect.width / 2 + (world[0]! - camera.x) * camera.zoom,
                  y: rect.height / 2 + (world[1]! - camera.y) * camera.zoom,
                };
                if (
                  point.x < 24 ||
                  point.x > rect.width - 24 ||
                  point.y < 24 ||
                  point.y > rect.height - 24
                )
                  continue;
                if (document.elementFromPoint(rect.left + point.x, rect.top + point.y) !== canvas)
                  continue;
                const tile = pickTile(point.x, point.y, map, camera, {
                  width: rect.width,
                  height: rect.height,
                });
                if (tile?.[0] === x && tile[1] === y) return { x, y, point };
              }
            }
          }
          throw new Error('The scenario has no second visible owned drop tile');
        }, guest);
        await page.mouse.move(nextDrop.point.x, nextDrop.point.y);
        await expect(page.locator('.person-pickup-ghost')).toBeVisible();
        await expect(page.locator('.person-drop-shadow')).toBeVisible();
        const heldGuestHeight = await page
          .locator('.person-pickup-ghost')
          .evaluate((canvas) => canvas.getBoundingClientRect().height);
        expect(Math.abs(heldGuestHeight / walkingGuestHeight - 1)).toBeLessThanOrEqual(0.1);
        const shadowSize = await page.locator('.person-drop-shadow').evaluate((shadow) => {
          const bounds = shadow.getBoundingClientRect();
          return { width: bounds.width, height: bounds.height };
        });
        const zoom = await page.evaluate(
          () => (window as unknown as { __camera: { zoom: number } }).__camera.zoom,
        );
        expect(shadowSize.width).toBeCloseTo(28 * zoom, 0);
        expect(shadowSize.height).toBeCloseTo(12 * zoom, 0);
        await tapCanvasAt(page, nextDrop.point, mobile);
        await expect(page.locator('.tool-status')).toContainText(/Guest moved|Drop refused/i);
        await expect.poll(readGuestPosition).toEqual({ x: nextDrop.x, y: nextDrop.y });

        const pickUpGuestAgain = guestWindow.getByRole('button', { name: 'Pick up' });
        await pickUpGuestAgain.scrollIntoViewIfNeeded();
        await pickUpGuestAgain.click();
        await guestWindow.getByRole('button', { name: /Close/ }).click();
        await guestsPanel.getByRole('button', { name: /Close/ }).click();
        const outside = await visibleUnownedTile(page);
        await tapCanvasAt(page, outside.point, mobile);
        await expect(page.locator('.tool-status')).toContainText(/owned|invalid/i);
        await expect.poll(readGuestPosition).toEqual({ x: nextDrop.x, y: nextDrop.y });
      } finally {
        await page.context().close();
        if (backend === 'Canvas2D') await page.context().browser()?.close();
      }
    });
  }
}

test('dragging a guest off the ground hides the hover outline left at its old spot', async ({
  browser,
}) => {
  const page = await startPage(browser, false, 'WebGL2');
  try {
    await startScenario(page, 'Meadowbrook Green');
    await toolbarAction(page, 'Pause');
    await toolbarAction(page, 'Game options');
    const options = page.locator('[data-panel="options"]');
    await options.getByRole('button', { name: 'Guests +1,000' }).click();
    await options.getByRole('button', { name: /Close/ }).click();
    await toolbarAction(page, 'Resume');
    await page.waitForTimeout(8_000);
    await toolbarAction(page, 'Pause');
    const centreOnWalkingGuest = () =>
      page.evaluate(async () => {
        const [{ project }, { TILE_UNITS }, { guestRowState }] = await Promise.all([
          import('/src/render/projection.ts'),
          import('/src/sim/core/constants.ts'),
          import('/src/worker/snapshot.ts'),
        ]);
        const state = window as unknown as {
          __camera: { x: number; y: number; rotation: 0 | 1 | 2 | 3 };
          __map: { width: number; height: number };
          __snapshot: { guests: { count: number; data: Int32Array }; guestIds: Int32Array };
        };
        const { guests, guestIds } = state.__snapshot;
        for (let slot = 0; slot < guests.count; slot++) {
          const rowState = guestRowState(guests.data[slot * 4 + 3]!);
          if (guestIds[slot]! <= 0 || rowState === 1 || rowState === 2 || rowState === 5) continue;
          const world = new Float64Array(2);
          project(
            (guests.data[slot * 4]! / 256) * TILE_UNITS,
            (guests.data[slot * 4 + 1]! / 256) * TILE_UNITS,
            0,
            state.__map.width,
            state.__map.height,
            state.__camera.rotation,
            world,
          );
          if (!Number.isFinite(world[0])) continue;
          state.__camera.x = world[0]!;
          state.__camera.y = world[1]!;
          return true;
        }
        return false;
      });
    await expect.poll(centreOnWalkingGuest).toBe(true);
    await page.waitForTimeout(1_500);
    const guest = await page.evaluate(async () => {
      const [{ buildObjectPickTargets, pickTopmostObject }, { spritePages }, { guestRowState }] =
        await Promise.all([
          import('/src/input/object-picking.ts'),
          import('/src/render/sprite-pages.ts'),
          import('/src/worker/snapshot.ts'),
        ]);
      const state = window as unknown as {
        __camera: Parameters<typeof buildObjectPickTargets>[2];
        __map: Parameters<typeof buildObjectPickTargets>[1];
        __snapshot: Parameters<typeof buildObjectPickTargets>[0];
      };
      const snapshot = state.__snapshot!;
      const rect = document.querySelector<HTMLCanvasElement>('#game')!.getBoundingClientRect();
      const targets = buildObjectPickTargets(
        snapshot,
        state.__map,
        state.__camera,
        { width: rect.width, height: rect.height },
        spritePages,
      );
      for (const target of targets) {
        if (target.kind !== 'guest' || target.personId === undefined) continue;
        const slot = snapshot.guestIds.indexOf(target.personId);
        const rowState = guestRowState(snapshot.guests.data[slot * 4 + 3]!);
        if (rowState === 1 || rowState === 2 || rowState === 5) continue;
        for (let pixel = 0; pixel < target.alpha.length; pixel++) {
          if (target.alpha[pixel] === 0) continue;
          const x =
            target.x + (((pixel % target.alphaWidth) + 0.5) / target.alphaWidth) * target.width;
          const y =
            target.y +
            ((Math.floor(pixel / target.alphaWidth) + 0.5) / target.alphaHeight) * target.height;
          if (x < 40 || y < 80 || x > rect.width - 40 || y > rect.height - 80) continue;
          if (pickTopmostObject(targets, x, y)?.id !== target.id) continue;
          return { x: rect.left + x, y: rect.top + y };
        }
      }
      throw new Error(
        `No walking guest has a visible sprite pixel: ${targets.length} targets, ${targets.filter((t) => t.kind === 'guest').length} guests, camera ${JSON.stringify(state.__camera)}`,
      );
    });
    await page.mouse.move(guest.x - 4, guest.y);
    await page.mouse.move(guest.x, guest.y);
    await expect(page.locator('.object-hover-outline')).toBeVisible();
    await page.mouse.down();
    await page.mouse.move(guest.x + 60, guest.y + 30, { steps: 4 });
    await expect(page.locator('.person-pickup-ghost')).toBeVisible();
    await expect(page.locator('.object-hover-outline')).toBeHidden();
    await page.mouse.up();
  } finally {
    await page.context().close();
  }
});
