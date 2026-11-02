import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test, type Page, type TestInfo } from './support/test';
import { openPage, toolbarAction } from './support/park';
import { UNFINISHED_PIECES, trackEditPark } from './support/track-edit-park';

type Backend = 'WebGL2' | 'Canvas2D';
type Device = 'desktop' | 'Pixel 8' | 'Pixel 8 landscape';

interface Piece {
  id: number;
  prev: number;
  next: number;
}

async function forceCanvas2D(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return original.call(this, type as '2d', ...(args as []));
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

async function loadPark(page: Page, testInfo: TestInfo): Promise<void> {
  const savePath = testInfo.outputPath('track-edit.ocsave');
  await mkdir(dirname(savePath), { recursive: true });
  await writeFile(savePath, trackEditPark());
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await toolbarAction(page, 'Game options');
  await page.getByRole('button', { name: 'Save, load and quit…' }).click();
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
  await expect(page.locator('.save-menu')).toBeHidden();
  const close = page.locator('.ui-window button[aria-label^="Close"]');
  while (await close.count()) await close.first().click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const snapshot = (
          window as unknown as {
            __snapshot?: { rides: { count: number }; tracks: { count: number } };
          }
        ).__snapshot;
        return snapshot ? `${snapshot.rides.count}:${snapshot.tracks.count}` : '';
      }),
    )
    .toBe('3:27');
}

/** The ride's pieces, in track order from the first piece of its first section (or its station). */
async function ridePieces(page: Page, rideId: number): Promise<Piece[]> {
  // A snapshot handed back to the worker for reuse has detached buffers; read a live one.
  const read = () =>
    page.evaluate((rideId) => {
      const snapshot = (
        window as unknown as {
          __snapshot?: { tracks: { count: number; data: Int32Array }; trackLinks: Int32Array };
        }
      ).__snapshot;
      if (!snapshot || snapshot.tracks.data.length === 0 || snapshot.trackLinks.length === 0)
        return null;
      const out: Array<{ id: number; prev: number; next: number; type: number }> = [];
      for (let i = 0; i < snapshot.tracks.count; i++) {
        const word = snapshot.tracks.data[i * 4 + 3];
        if (word >>> 16 !== rideId) continue;
        out.push({
          id: snapshot.trackLinks[i * 3],
          prev: snapshot.trackLinks[i * 3 + 1],
          next: snapshot.trackLinks[i * 3 + 2],
          type: word & 0xff,
        });
      }
      return out;
    }, rideId);
  let rows = await read();
  await expect.poll(async () => (rows = await read()) !== null).toBe(true);
  if (!rows) throw new Error('No live snapshot');
  const byId = new Map(rows.map((row) => [row.id, row]));
  const first = rows.find((row) => row.prev < 0) ?? rows.find((row) => row.type === 0) ?? rows[0];
  const ordered: Piece[] = [];
  for (let at = first; at && ordered.length < rows.length; at = byId.get(at.next)!)
    ordered.push({ id: at.id, prev: at.prev, next: at.next });
  for (const row of rows)
    if (!ordered.some((piece) => piece.id === row.id))
      ordered.push({ id: row.id, prev: row.prev, next: row.next });
  return ordered;
}

/** Centres the camera on a piece's rails and returns a viewport point where they are on top. */
async function pointOnPiece(page: Page, pieceId: number): Promise<{ x: number; y: number }> {
  const find = () =>
    page.locator('#game').evaluate(async (canvas, pieceId) => {
      const [{ buildObjectPickTargets, pickTrackPiece }, { spritePages }] = await Promise.all([
        import('/src/input/object-picking.ts'),
        import('/src/render/sprite-pages.ts'),
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
      const mine = (t: ReturnType<typeof buildObjectPickTargets>[number]) =>
        t.coasterPart === 'track' && t.pieceId === pieceId;
      camera.zoom = 2;
      // Centre the piece in the part of the map no window or sheet covers.
      let top = rect.top;
      while (top < rect.bottom && document.elementFromPoint(rect.left + 2, top) !== canvas)
        top += 4;
      let bottom = top;
      while (bottom < rect.bottom && document.elementFromPoint(rect.left + 2, bottom) === canvas)
        bottom += 4;
      let targets = buildObjectPickTargets(snapshot, map, camera, viewport, spritePages);
      const first = targets.find(mine);
      if (!first) return null;
      camera.x += (first.x + first.width / 2 - viewport.width / 2) / camera.zoom;
      camera.y += (first.y + first.height / 2 - ((top + bottom) / 2 - rect.top)) / camera.zoom;
      targets = buildObjectPickTargets(snapshot, map, camera, viewport, spritePages);
      for (const target of targets.filter(mine)) {
        for (let i = 0; i < target.alpha.length; i += 3) {
          if (target.alpha[i] === 0) continue;
          const x = target.x + (((i % target.alphaWidth) + 0.5) / target.alphaWidth) * target.width;
          const y =
            target.y +
            ((Math.floor(i / target.alphaWidth) + 0.5) / target.alphaHeight) * target.height;
          if (document.elementFromPoint(rect.left + x, rect.top + y) !== canvas) continue;
          const hit = pickTrackPiece(targets, x, y);
          if (hit && 'pieceId' in hit && hit.pieceId === pieceId)
            return { x: rect.left + x, y: rect.top + y };
        }
      }
      return null;
    }, pieceId);
  await expect.poll(find, { timeout: 30_000 }).not.toBeNull();
  const point = await find();
  if (!point) throw new Error(`Piece ${pieceId} has no visible rail pixel`);
  return point;
}

async function tapOrClick(page: Page, mobile: boolean, point: { x: number; y: number }) {
  if (mobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

const construction = (page: Page) =>
  page.locator('[data-window-id="construction"], .coaster-panel');
const selectionLine = (page: Page) => page.locator('.coaster-selection-line');
const rideInfo = (page: Page) => page.locator('.coaster-info');

async function expectHighlightAt(page: Page, point: { x: number; y: number }): Promise<void> {
  const outline = page.locator('.track-selection-outline');
  await expect(outline).toBeVisible();
  const box = (await outline.boundingBox())!;
  expect(point.x).toBeGreaterThanOrEqual(box.x - 2);
  expect(point.x).toBeLessThanOrEqual(box.x + box.width + 2);
  expect(point.y).toBeGreaterThanOrEqual(box.y - 2);
  expect(point.y).toBeLessThanOrEqual(box.y + box.height + 2);
}

/**
 * Expects the piece to be on screen with its rails uncovered by any window, sheet or bar, and the
 * selection outline drawn over it.
 */
async function expectPieceUncovered(page: Page, pieceId: number): Promise<void> {
  const check = () =>
    page.locator('#game').evaluate(async (canvas, pieceId) => {
      const [{ buildObjectPickTargets }, { spritePages }] = await Promise.all([
        import('/src/input/object-picking.ts'),
        import('/src/render/sprite-pages.ts'),
      ]);
      const state = window as unknown as {
        __camera: Parameters<typeof buildObjectPickTargets>[2];
        __map: Parameters<typeof buildObjectPickTargets>[1];
        __snapshot: Parameters<typeof buildObjectPickTargets>[0];
      };
      const rect = canvas.getBoundingClientRect();
      const targets = buildObjectPickTargets(
        state.__snapshot,
        state.__map,
        state.__camera,
        { width: rect.width, height: rect.height },
        spritePages,
      ).filter((t) => t.coasterPart === 'track' && t.pieceId === pieceId);
      if (!targets.length) return 'not on screen';
      let rails = 0;
      let uncovered = 0;
      for (const target of targets) {
        for (let i = 0; i < target.alpha.length; i += 2) {
          if (target.alpha[i] === 0) continue;
          rails++;
          const x =
            rect.left +
            target.x +
            (((i % target.alphaWidth) + 0.5) / target.alphaWidth) * target.width;
          const y =
            rect.top +
            target.y +
            ((Math.floor(i / target.alphaWidth) + 0.5) / target.alphaHeight) * target.height;
          if (document.elementFromPoint(x, y) === canvas) uncovered++;
        }
      }
      if (rails === 0 || uncovered / rails < 0.99)
        return `${rails - uncovered} of ${rails} rail pixels covered`;
      const outline = document.querySelector<HTMLElement>('.track-selection-outline');
      if (!outline || outline.hidden) return 'no outline';
      const box = outline.getBoundingClientRect();
      const left = rect.left + Math.min(...targets.map((t) => t.x));
      const top = rect.top + Math.min(...targets.map((t) => t.y));
      const right = rect.left + Math.max(...targets.map((t) => t.x + t.width));
      const bottom = rect.top + Math.max(...targets.map((t) => t.y + t.height));
      const near = (a: number, b: number) => Math.abs(a - b) <= 8;
      if (
        !near(box.left, left) ||
        !near(box.top, top) ||
        !near(box.right, right) ||
        !near(box.bottom, bottom)
      )
        return 'outline elsewhere';
      return 'ok';
    }, pieceId);
  await expect.poll(check, { timeout: 20_000 }).toBe('ok');
}

/** The selection, Build and Demolish controls are on screen without scrolling the window. */
async function expectEditControlsInView(page: Page): Promise<void> {
  const panel = construction(page);
  for (const name of [/^Previous piece$/, /^Next piece$/, /^Demolish/, /^Build piece$/])
    await expect(panel.getByRole('button', { name })).toBeInViewport({ ratio: 1 });
}

async function cameraPosition(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const { x, y } = (window as unknown as { __camera: { x: number; y: number } }).__camera;
    return { x, y };
  });
}

async function shot(page: Page, testInfo: TestInfo, name: string, at: { x: number; y: number }) {
  const viewport = page.viewportSize()!;
  const outline = page.locator('.track-selection-outline');
  const box = (await outline.isVisible()) ? await outline.boundingBox() : null;
  const point = box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : at;
  const width = Math.min(560, viewport.width);
  const height = Math.min(380, viewport.height);
  const left = Math.max(0, Math.min(viewport.width - width, point.x - width / 2));
  const top = Math.max(0, Math.min(viewport.height - height, point.y - height / 2));
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    clip: { x: left, y: top, width, height },
    timeout: 60_000,
  });
  await page.screenshot({ path: testInfo.outputPath(`${name}-full.png`), timeout: 60_000 });
}

async function fastForward(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) await page.keyboard.press('+');
}

async function editClosedCircuit(page: Page, device: Device, testInfo: TestInfo): Promise<void> {
  const mobile = device !== 'desktop';
  await toolbarAction(page, 'Pause');
  const circuit = await ridePieces(page, 0);
  expect(circuit).toHaveLength(14);
  const middle = circuit[6];
  const point = await pointOnPiece(page, middle.id);

  await tapOrClick(page, mobile, point);
  const rideWindow = page.locator('[data-panel^="ride-"]:visible');
  await expect(rideWindow).toHaveCount(1);
  const before = await cameraPosition(page);
  await page.getByRole('button', { name: 'Edit from this piece' }).click();
  await expect(selectionLine(page)).toContainText('Selected piece 7 of 14');
  await expect(rideInfo(page)).toContainText('Track 14 pieces');
  // The desktop camera stays put; a phone frames the piece above its construction sheet.
  await expectPieceUncovered(page, middle.id);
  if (!mobile) {
    await expectHighlightAt(page, point);
    expect(await cameraPosition(page)).toEqual(before);
  }
  if (mobile) await expectEditControlsInView(page);
  await shot(page, testInfo, 'circuit-selected', point);

  await page.getByRole('button', { name: 'Next piece' }).click();
  await expect(selectionLine(page)).toContainText('Selected piece 8 of 14');
  await expectPieceUncovered(page, circuit[7].id);
  await page.getByRole('button', { name: 'Previous piece' }).click();
  await expect(selectionLine(page)).toContainText('Selected piece 7 of 14');
  await expectPieceUncovered(page, middle.id);

  // The camera follows the selection, not the clock: a pan away holds until the next selection.
  const panned = await page.evaluate(() => {
    const camera = (window as unknown as { __camera: { x: number; y: number } }).__camera;
    camera.x += 300;
    camera.y += 200;
    return { x: camera.x, y: camera.y };
  });
  await toolbarAction(page, 'Resume');
  await page.waitForTimeout(1_500);
  await toolbarAction(page, 'Pause');
  expect(await cameraPosition(page)).toEqual(panned);
  await page.getByRole('button', { name: 'Next piece' }).click();
  await expect(selectionLine(page)).toContainText('Selected piece 8 of 14');
  await expectPieceUncovered(page, circuit[7].id);
  await page.getByRole('button', { name: 'Previous piece' }).click();
  await expect(selectionLine(page)).toContainText('Selected piece 7 of 14');

  await page.getByRole('button', { name: 'Demolish selected piece' }).click();
  await expect(rideInfo(page)).toContainText('Track 13 pieces');
  const after = (await ridePieces(page, 0)).map((piece) => piece.id);
  expect(after).not.toContain(middle.id);
  for (const piece of circuit) if (piece !== middle) expect(after).toContain(piece.id);
  await expect(selectionLine(page)).toContainText('of 13');
  await expectPieceUncovered(page, circuit[5].id);
  if (mobile) await expectEditControlsInView(page);
  await shot(page, testInfo, 'circuit-gap', point);

  await page.getByRole('button', { name: 'Right small' }).click();
  await page.getByRole('button', { name: 'Level', exact: true }).click();
  await page.getByRole('button', { name: 'No bank' }).click();
  await page.getByRole('button', { name: 'Build piece' }).click();
  await expect(rideInfo(page)).toContainText('Track 14 pieces');
  await expect(rideInfo(page)).toContainText('Circuit complete');
  await expect(selectionLine(page)).toContainText('Building from the end of the track');
  // With nothing selected, Previous picks the last piece built: here the one that closed the gap.
  await page.getByRole('button', { name: 'Previous piece' }).click();
  await expect(selectionLine(page)).toContainText('Selected piece 7 of 14');
  await expectPieceUncovered(page, (await ridePieces(page, 0))[6].id);
  await shot(page, testInfo, 'circuit-rebuilt', point);
  await page.getByRole('button', { name: 'Track end' }).click();
  await expect(selectionLine(page)).toContainText('Building from the end of the track');

  await toolbarAction(page, 'Resume');
  await fastForward(page);
  await construction(page).getByRole('button', { name: 'Test', exact: true }).click();
  await expect(rideInfo(page)).toContainText('Excitement', { timeout: 240_000 });
  await construction(page).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(rideInfo(page)).toContainText('Open');
  await toolbarAction(page, 'Pause');

  const busy = await pointOnPiece(page, circuit[3].id);
  await tapOrClick(page, mobile, busy);
  await expect(selectionLine(page)).toContainText('Selected piece 4 of 14');
  await page.getByRole('button', { name: 'Demolish selected piece' }).click();
  await expect(page.locator('.coaster-feedback')).toContainText(
    'Close the ride and wait for its train',
  );
  await expect(rideInfo(page)).toContainText('Track 14 pieces');
}

async function editUnfinished(page: Page, device: Device, testInfo: TestInfo): Promise<void> {
  const mobile = device !== 'desktop';
  await toolbarAction(page, 'Pause');
  const unfinished = await ridePieces(page, 1);
  const overpass = await ridePieces(page, 2);
  expect(unfinished).toHaveLength(UNFINISHED_PIECES.length);

  const upper = await pointOnPiece(page, overpass[3].id);
  await tapOrClick(page, mobile, upper);
  await page.getByRole('button', { name: 'Edit from this piece' }).click();
  await expect(selectionLine(page)).toContainText('Selected piece 4 of 6');
  if (!mobile) await expectHighlightAt(page, upper);
  await expectPieceUncovered(page, overpass[3].id);

  const lower = await pointOnPiece(page, unfinished[3].id);
  await tapOrClick(page, mobile, lower);
  await expect(selectionLine(page)).toContainText('Selected piece 4 of 7');
  await expect(rideInfo(page)).toContainText('Track 7 pieces');
  await expectHighlightAt(page, lower);
  await shot(page, testInfo, 'stacked-lower-selected', lower);

  await page.getByRole('button', { name: 'Demolish selected piece' }).click();
  await expect(rideInfo(page)).toContainText('Track 6 pieces');
  const remaining = (await ridePieces(page, 1)).map((piece) => piece.id);
  for (const piece of unfinished)
    expect(remaining.includes(piece.id)).toBe(piece !== unfinished[3]);
  await expect(selectionLine(page)).toContainText('Selected piece 3 of 3');

  await page.getByRole('button', { name: 'Straight' }).click();
  await page.getByRole('button', { name: 'Build piece' }).click();
  await expect(rideInfo(page)).toContainText('Track 7 pieces');
  await expect(selectionLine(page)).toContainText('Selected piece 4 of 7');
  await shot(page, testInfo, 'unfinished-reconnected', lower);

  await toolbarAction(page, 'Rotate right');
  const rotated = await pointOnPiece(page, unfinished[5].id);
  await tapOrClick(page, mobile, rotated);
  await expect(selectionLine(page)).toContainText('Selected piece 6 of 7');
  await expectHighlightAt(page, rotated);
  await shot(page, testInfo, 'rotated-selected', rotated);

  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Previous piece' }).click();
  await expect(selectionLine(page)).toContainText('Selected piece 1 of 7');
  await expect(page.getByRole('button', { name: 'Previous piece' })).toBeDisabled();
  await page.getByRole('button', { name: 'Build before this piece' }).click();
  await page.getByRole('button', { name: 'Straight' }).click();
  await page.getByRole('button', { name: 'Build piece' }).click();
  await expect(rideInfo(page)).toContainText('Track 8 pieces');
  await expect(selectionLine(page)).toContainText('Selected piece 1 of 8');

  await page.getByRole('button', { name: 'Track end' }).click();
  await expect(selectionLine(page)).toContainText('Building from the end of the track');
  await expect(page.locator('.track-selection-outline')).toBeHidden();
  await page.getByRole('button', { name: 'Demolish last piece' }).click();
  await expect(rideInfo(page)).toContainText('Track 7 pieces');
  const last = await ridePieces(page, 1);
  expect(last.map((piece) => piece.id)).not.toContain(unfinished[6].id);
}

const FLOWS = [
  ['rebuilds a removed piece of a closed circuit, retests and reopens it', editClosedCircuit],
  ['edits unfinished and stacked track from the clicked piece', editUnfinished],
] as const;

for (const backend of ['WebGL2', 'Canvas2D'] as const satisfies readonly Backend[]) {
  for (const device of [
    'desktop',
    'Pixel 8',
    'Pixel 8 landscape',
  ] as const satisfies readonly Device[]) {
    test.describe(`editing track from a chosen piece in ${backend} on ${device}`, () => {
      // The short landscape phone covers the circuit flow: select, step, rebuild, retest, reopen.
      for (const [name, run] of device === 'Pixel 8 landscape'
        ? FLOWS.filter(([, run]) => run === editClosedCircuit)
        : FLOWS) {
        test(name, async ({ browser }, testInfo) => {
          test.setTimeout(480_000);
          const page = await openPage(browser, device !== 'desktop');
          try {
            if (device === 'desktop') await page.setViewportSize({ width: 1280, height: 800 });
            if (device === 'Pixel 8 landscape')
              await page.setViewportSize({ width: 915, height: 412 });
            if (backend === 'Canvas2D') await forceCanvas2D(page);
            await loadPark(page, testInfo);
            await expect(page.locator('.hud')).toContainText(backend);
            await run(page, device, testInfo);
          } finally {
            await page.context().close();
          }
        });
      }
    });
  }
}
