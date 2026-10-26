import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { openPage, startScenario, toolbarAction } from './support/park';

async function visibleSceneryPoint(page: Page): Promise<{ name: string; x: number; y: number }> {
  return page.locator('#game').evaluate(async (canvas) => {
    const [{ SCENERY_CATALOG }, { project }, { sceneryBox, sceneryGroundZ }, { TILE_UNITS }] =
      await Promise.all([
        import('/src/sim/map/scenery.ts'),
        import('/src/render/projection.ts'),
        import('/src/render/ground-anchor.ts'),
        import('/src/sim/core/constants.ts'),
      ]);
    const state = window as unknown as {
      __camera: { x: number; y: number; zoom: number; rotation: 0 | 1 | 2 | 3 };
      __map: {
        width: number;
        height: number;
        heights: Uint8Array;
        slope: Uint8Array;
        sceneryElements: Int32Array;
        sceneryCount: number;
      };
    };
    const rect = canvas.getBoundingClientRect();
    const { __camera: camera, __map: map } = state;
    const out = new Float64Array(2);
    for (let i = 0; i < map.sceneryCount; i++) {
      const offset = i * 5;
      const tileX = map.sceneryElements[offset]!;
      const tileY = map.sceneryElements[offset + 1]!;
      const definition = SCENERY_CATALOG[map.sceneryElements[offset + 4]!];
      if (!definition) continue;
      const tile = tileY * map.width + tileX;
      const z = sceneryGroundZ(map.heights[tile]!, map.slope[tile]!, camera.rotation);
      project(
        tileX * TILE_UNITS + TILE_UNITS / 2,
        tileY * TILE_UNITS + TILE_UNITS / 2,
        z,
        map.width,
        map.height,
        camera.rotation,
        out,
      );
      const screenX = rect.width / 2 + (out[0]! - camera.x) * camera.zoom;
      const screenY = rect.height / 2 + (out[1]! - camera.y) * camera.zoom;
      const box = sceneryBox(definition);
      const point = {
        x: rect.left + screenX,
        y: rect.top + screenY - box.height * camera.zoom * 0.55,
      };
      if (
        point.x > rect.left + 12 &&
        point.x < rect.right - 12 &&
        point.y > rect.top + 12 &&
        point.y < rect.bottom - 80
      )
        return { name: definition.name, ...point };
    }
    throw new Error('The scenario has no scenery sprite in the visible game area');
  });
}

async function visibleRidePoint(
  page: Page,
  kind: 'flat-ride' | 'facility',
): Promise<{
  id: number;
  name: string;
  x: number;
  y: number;
  bodyCellIndices: number[];
  expectedBodySliceCount: number;
  outlineCellIndices: number[];
  outlineIncludesEntranceAndExit: boolean;
  hasEntranceAndExit: boolean;
  outlineBounds: { x: number; y: number; width: number; height: number };
}> {
  return page.locator('#game').evaluate(async (canvas, kind) => {
    const [
      { RIDE_CATALOG },
      { RideInfo, RIDE_INFO_STRIDE },
      { isSlicedRide },
      { hoverGroup },
      { buildObjectPickTargets, pickTopmostObject },
      { spritePages },
    ] = await Promise.all([
      import('/src/sim/rides/ride-types.ts'),
      import('/src/worker/snapshot.ts'),
      import('/src/render/ride-scene.ts'),
      import('/src/app/tools/object-overlay.ts'),
      import('/src/input/object-picking.ts'),
      import('/src/render/sprite-pages.ts'),
    ]);
    const state = window as unknown as {
      __camera: { x: number; y: number; zoom: number; rotation: 0 | 1 | 2 | 3 };
      __map: Parameters<typeof buildObjectPickTargets>[1];
      __snapshot: Parameters<typeof buildObjectPickTargets>[0];
    };
    const { __camera: camera, __map: map, __snapshot: snapshot } = state;
    if (!snapshot) throw new Error('The park snapshot is not ready');
    const rect = canvas.getBoundingClientRect();
    const viewport = { width: rect.width, height: rect.height };
    let targets = buildObjectPickTargets(snapshot, map, camera, viewport, spritePages);
    for (let i = 0; i < snapshot.rides.count; i++) {
      const o = i * RIDE_INFO_STRIDE;
      const definition = RIDE_CATALOG[snapshot.rideInfo[o + RideInfo.Type]!];
      const facility = definition && ['shop', 'stall', 'facility'].includes(definition.category);
      if (!definition || definition.usesTrack || facility !== (kind === 'facility')) continue;
      const rideId = snapshot.rideInfo[o + RideInfo.Id]!;
      for (const target of targets) {
        if (target.kind !== 'ride' || target.rideId !== rideId) continue;
        const findPixel = (candidate: (typeof targets)[number]) => {
          for (let pixel = 0; pixel < candidate.alpha.length; pixel++) {
            if (candidate.alpha[pixel] === 0) continue;
            const x =
              candidate.x +
              (((pixel % candidate.alphaWidth) + 0.5) / candidate.alphaWidth) * candidate.width;
            const y =
              candidate.y +
              ((Math.floor(pixel / candidate.alphaWidth) + 0.5) / candidate.alphaHeight) *
                candidate.height;
            if (x < 4 || y < 4 || x >= rect.width - 4 || y >= rect.height - 80) continue;
            if (pickTopmostObject(targets, x, y)?.id !== candidate.id) continue;
            return { id: rideId, name: definition.name, x: rect.left + x, y: rect.top + y };
          }
          return null;
        };
        const describe = (candidate: (typeof targets)[number]) => {
          const point = findPixel(candidate);
          if (!point) return null;
          const group = hoverGroup(candidate, targets, new Set([rideId]));
          const left = Math.min(...group.map((item) => item.x));
          const top = Math.min(...group.map((item) => item.y));
          const right = Math.max(...group.map((item) => item.x + item.width));
          const bottom = Math.max(...group.map((item) => item.y + item.height));
          const entranceTargets = targets.filter(
            (item) =>
              item.kind === 'ride' && item.rideId === rideId && item.sprite?.includes('/entrance/'),
          );
          const exitTargets = targets.filter(
            (item) =>
              item.kind === 'ride' && item.rideId === rideId && item.sprite?.includes('/exit/'),
          );
          return {
            ...point,
            bodyCellIndices: targets
              .filter(
                (candidate) =>
                  candidate.kind === 'ride' &&
                  candidate.rideId === rideId &&
                  candidate.sprite?.includes('/cell-'),
              )
              .map((candidate) => Number(candidate.sprite!.match(/\/cell-(\d+)/)?.[1])),
            expectedBodySliceCount: isSlicedRide(definition.id) ? definition.footprint.length : 1,
            outlineCellIndices: group
              .filter((candidate) => candidate.sprite?.includes('/cell-'))
              .map((candidate) => Number(candidate.sprite!.match(/\/cell-(\d+)/)?.[1])),
            outlineIncludesEntranceAndExit:
              entranceTargets.every((target) => group.some((item) => item.id === target.id)) &&
              exitTargets.every((target) => group.some((item) => item.id === target.id)),
            hasEntranceAndExit: entranceTargets.length > 0 && exitTargets.length > 0,
            outlineBounds: { x: left, y: top, width: right - left, height: bottom - top },
          };
        };
        const match = describe(target);
        if (match) return match;
        camera.x += (target.x + target.width / 2 - viewport.width / 2) / camera.zoom;
        camera.y += (target.y + target.height / 2 - viewport.height / 2) / camera.zoom;
        targets = buildObjectPickTargets(snapshot, map, camera, viewport, spritePages);
        const centeredTarget = targets.find((candidate) => candidate.id === target.id);
        if (centeredTarget) {
          const matchAfterCentering = describe(centeredTarget);
          if (matchAfterCentering) return matchAfterCentering;
        }
      }
    }
    throw new Error(`The scenario has no visible ${kind}`);
  }, kind);
}

async function visibleParkPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.locator('#game').evaluate(async (canvas) => {
    const [{ project }, { TILE_UNITS, Z_STEP }] = await Promise.all([
      import('/src/render/projection.ts'),
      import('/src/sim/core/constants.ts'),
    ]);
    const state = window as unknown as {
      __camera: { x: number; y: number; zoom: number; rotation: 0 | 1 | 2 | 3 };
      __map: { width: number; height: number; heights: Uint8Array };
      __snapshot: {
        park: { entranceX: number; entranceY: number };
      };
    };
    const { __camera: camera, __map: map, __snapshot: snapshot } = state;
    const rect = canvas.getBoundingClientRect();
    const { entranceX: x, entranceY: y } = snapshot.park;
    if (x < 0 || y < 0) throw new Error('The scenario has no park entrance');
    const point = new Float64Array(2);
    project(
      (x + 0.5) * TILE_UNITS,
      (y + 0.5) * TILE_UNITS,
      map.heights[y * map.width + x]! * Z_STEP,
      map.width,
      map.height,
      camera.rotation,
      point,
    );
    return {
      x: rect.left + rect.width / 2 + (point[0]! - camera.x) * camera.zoom,
      y: rect.top + rect.height / 2 + (point[1]! - camera.y) * camera.zoom - 18 * camera.zoom,
    };
  });
}

async function visiblePersonTarget(
  page: Page,
  kind: 'guest' | 'staff',
): Promise<{ id: number; name: string; x: number; y: number }> {
  const find = () =>
    page.locator('#game').evaluate(async (canvas, kind) => {
      const [{ buildObjectPickTargets, pickTopmostObject }, { spritePages }, { project }] =
        await Promise.all([
          import('/src/input/object-picking.ts'),
          import('/src/render/sprite-pages.ts'),
          import('/src/render/projection.ts'),
        ]);
      const state = window as unknown as {
        __camera: { x: number; y: number; zoom: number; rotation: 0 | 1 | 2 | 3 };
        __map: Parameters<typeof buildObjectPickTargets>[1];
        __snapshot: Parameters<typeof buildObjectPickTargets>[0];
      };
      const { __camera: camera, __map: map, __snapshot: snapshot } = state;
      if (!snapshot) return null;
      const rect = canvas.getBoundingClientRect();
      const viewport = { width: rect.width, height: rect.height };
      const targets = buildObjectPickTargets(snapshot, map, camera, viewport, spritePages);
      let personTarget: (typeof targets)[number] | undefined;
      for (const target of targets) {
        if (target.kind !== kind) continue;
        personTarget ??= target;
        for (let i = 0; i < target.alpha.length; i++) {
          if (target.alpha[i] === 0) continue;
          const pixelX = i % target.alphaWidth;
          const pixelY = Math.floor(i / target.alphaWidth);
          const x = target.x + ((pixelX + 0.5) / target.alphaWidth) * target.width;
          const y = target.y + ((pixelY + 0.5) / target.alphaHeight) * target.height;
          if (x < 4 || y < 4 || x >= viewport.width - 4 || y >= viewport.height - 80) continue;
          if (pickTopmostObject(targets, x, y)?.id !== target.id) continue;
          return {
            id: target.personId!,
            name: target.name,
            x: rect.left + x,
            y: rect.top + y,
          };
        }
      }
      if (personTarget?.personId !== undefined) {
        const ids = kind === 'guest' ? snapshot.guestIds : snapshot.staffIds;
        const rows = kind === 'guest' ? snapshot.guests : snapshot.staff;
        const slot = ids.indexOf(personTarget.personId);
        if (slot >= 0) {
          const offset = slot * 4;
          const world = new Float64Array(2);
          project(
            rows.data[offset]!,
            rows.data[offset + 1]!,
            rows.data[offset + 2]!,
            map.width,
            map.height,
            camera.rotation,
            world,
          );
          camera.x = world[0]!;
          camera.y = world[1]!;
        }
      }
      return null;
    }, kind);
  await expect.poll(find).not.toBeNull();
  const target = await find();
  if (!target) throw new Error(`No visible ${kind} sprite can be selected`);
  return target;
}

async function longPress(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.locator('#game').evaluate(async (canvas, position) => {
    if (!Object.hasOwn(canvas, 'setPointerCapture'))
      Object.defineProperty(canvas, 'setPointerCapture', { value: () => {} });
    const dispatch = (type: string, buttons: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 9,
          pointerType: 'touch',
          isPrimary: true,
          bubbles: true,
          clientX: position.x,
          clientY: position.y,
          buttons,
        }),
      );
    dispatch('pointerdown', 1);
    await new Promise((resolve) => setTimeout(resolve, 950));
    dispatch('pointerup', 0);
  }, point);
}

async function openInspectionPage(browser: Browser, mobile: boolean): Promise<Page> {
  const page = await openPage(browser, mobile);
  if (!mobile) await page.setViewportSize({ width: 1280, height: 800 });
  return page;
}

async function inspectScenery(
  browser: Browser,
  mobile: boolean,
  backend: 'WebGL2' | 'Canvas2D',
  testInfo: TestInfo,
): Promise<void> {
  let testBrowser = browser;
  let launchedBrowser: Browser | null = null;
  if (backend === 'Canvas2D') {
    launchedBrowser = await browser.browserType().launch({ args: ['--disable-webgl'] });
    testBrowser = launchedBrowser;
  }
  const page = await openInspectionPage(testBrowser, mobile);
  try {
    await startScenario(page, 'Meadowbrook Green');
    await expect(page.locator('.hud')).toContainText(backend);
    await toolbarAction(page, 'Pause');
    const initialParkWindow = page.locator('[data-panel="park"]:visible');
    if (await initialParkWindow.count())
      await initialParkWindow.locator('button[aria-label^="Close"]').click();
    await toolbarAction(page, 'Game options');
    await page
      .locator('[data-panel="options"]')
      .getByRole('button', { name: 'Guests +1,000' })
      .click();
    await toolbarAction(page, 'Resume');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __snapshot: { guests: { count: number } } }).__snapshot.guests
              .count,
        ),
      )
      .toBeGreaterThan(0);
    await page.locator('[data-panel="options"]').locator('button[aria-label^="Close"]').click();
    await toolbarAction(page, 'Staff');
    const staffPanel = page.locator('[data-panel="staff"]');
    await staffPanel.getByRole('button', { name: 'Hire Handyman' }).click();
    await staffPanel.locator('button[aria-label^="Close"]').click();
    await page.waitForTimeout(2_000);
    await toolbarAction(page, 'Pause');
    const scenery = await visibleSceneryPoint(page);

    if (mobile) {
      await page.locator('#game').evaluate(async (canvas, point) => {
        Object.defineProperty(canvas, 'setPointerCapture', { value: () => {} });
        const send = (type: string, buttons: number) =>
          canvas.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 2,
              pointerType: 'touch',
              isPrimary: true,
              bubbles: true,
              clientX: point.x,
              clientY: point.y,
              buttons,
            }),
          );
        send('pointerdown', 1);
        await new Promise((resolve) => setTimeout(resolve, 950));
        send('pointerup', 0);
      }, scenery);
    } else {
      await page.mouse.move(scenery.x, scenery.y);
      await expect(page.locator('.tool-status')).toContainText(scenery.name);
      await expect(page.locator('.object-hover-outline')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('hover.png') });
      await page.mouse.click(scenery.x, scenery.y);
    }
    const popup = page.locator('[data-object-info]');
    await expect(popup).toBeVisible();
    await expect(popup).toContainText(scenery.name);
    if (mobile) await expect(page.locator('.tool-status')).toContainText(scenery.name);
    await expect(popup.getByRole('button', { name: 'Remove' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('object-info.png') });
    await popup.getByRole('button', { name: 'Done' }).click();
    for (const kind of ['flat-ride', 'facility'] as const) {
      const ride = await visibleRidePoint(page, kind);
      if (kind === 'flat-ride') {
        const expectedCells = Array.from({ length: ride.expectedBodySliceCount }, (_, i) => i);
        expect(ride.bodyCellIndices.sort((a, b) => a - b)).toEqual(expectedCells);
        expect(ride.outlineCellIndices.sort((a, b) => a - b)).toEqual(expectedCells);
        if (ride.hasEntranceAndExit) expect(ride.outlineIncludesEntranceAndExit).toBe(true);
      }
      if (mobile) await longPress(page, ride);
      else {
        await page.mouse.move(ride.x, ride.y);
        await expect(page.locator('.tool-status')).toContainText(ride.name);
        await expect(page.locator('.object-hover-outline')).toBeVisible();
        if (kind === 'flat-ride') {
          const outline = await page.locator('.object-hover-outline').boundingBox();
          const canvas = await page.locator('#game').boundingBox();
          expect(outline).not.toBeNull();
          expect(canvas).not.toBeNull();
          expect(outline!.x).toBeCloseTo(canvas!.x + ride.outlineBounds.x - 2, 0);
          expect(outline!.y).toBeCloseTo(canvas!.y + ride.outlineBounds.y - 2, 0);
          expect(outline!.width).toBeGreaterThan(ride.outlineBounds.width);
          expect(outline!.height).toBeGreaterThan(ride.outlineBounds.height);
        }
        await page.screenshot({ path: testInfo.outputPath(`${kind}-hover.png`) });
        await page.mouse.click(ride.x, ride.y);
      }
      const rideWindow = page.locator(`[data-panel="ride-${ride.id}"]`);
      await expect(rideWindow).toBeVisible();
      if (mobile) await expect(page.locator('.tool-status')).toContainText(ride.name);
      await page.screenshot({ path: testInfo.outputPath(`${kind}-window.png`) });
      await rideWindow.locator('button[aria-label^="Close"]').click();
    }
    const park = await visibleParkPoint(page);
    if (mobile) await longPress(page, park);
    else await page.mouse.click(park.x, park.y);
    const parkWindow = page.locator('[data-panel="park"]');
    await expect(parkWindow).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('park-window.png') });
    await parkWindow.locator('button[aria-label^="Close"]').click();
    for (const kind of ['guest', 'staff'] as const) {
      for (let zoomOut = 0; zoomOut < 2; zoomOut++) await toolbarAction(page, 'Zoom out');
      const person = await visiblePersonTarget(page, kind);
      if (mobile) await page.touchscreen.tap(person.x, person.y);
      else {
        await page.mouse.move(person.x, person.y);
        await expect(page.locator('.tool-status')).toContainText(person.name);
        await expect(page.locator('.object-hover-outline')).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`${kind}-hover.png`) });
        await page.mouse.click(person.x, person.y);
      }
      const panel = page.locator(
        `[data-panel="${kind === 'guest' ? 'guest' : 'worker'}-${person.id}"]`,
      );
      await expect(panel).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${kind}-window.png`) });
      await panel.locator('button[aria-label^="Close"]').click();
    }
  } finally {
    await page.context().close();
    await launchedBrowser?.close();
  }
}

for (const backend of ['WebGL2', 'Canvas2D'] as const) {
  for (const mobile of [false, true]) {
    test(`${backend} scenery inspection on ${mobile ? 'Pixel 8' : 'desktop'}`, async ({
      browser,
    }, testInfo) => inspectScenery(browser, mobile, backend, testInfo));
  }
}
