import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { openPage, toolbarAction } from '../../e2e/support/park';
import { trackEditPark } from '../../e2e/support/track-edit-park';

/**
 * Live check without dev hooks: LOCAL_URL (dev server) finds a rail point of a circuit piece low on
 * the screen at the default camera; the same tap is then replayed on LIVE_URL.
 */
const OUT = process.env.PROOF_OUT ?? 'out/live';
const LOCAL = process.env.LOCAL_URL ?? 'http://127.0.0.1:4173';
const LIVE = process.env.LIVE_URL ?? 'https://opencoaster.noriagentic.com';

async function loadPark(page: Page, base: string): Promise<void> {
  const savePath = `${OUT}/track-edit.ocsave`;
  await mkdir(OUT, { recursive: true });
  await writeFile(savePath, trackEditPark());
  await page.goto(base + '/');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await toolbarAction(page, 'Game options');
  await page.getByRole('button', { name: 'Save, load and quit…' }).click();
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
  await expect(page.locator('.save-menu')).toBeHidden();
  const close = page.locator('.ui-window button[aria-label^="Close"]');
  while (await close.count()) await close.first().click();
  await page.waitForTimeout(3_000);
  await toolbarAction(page, 'Pause');
}

/** The lowest on-screen rail point of a circuit piece that the picker resolves to that piece. */
async function lowRail(page: Page): Promise<{ x: number; y: number; pieceId: number } | null> {
  return page.locator('#game').evaluate(async (canvas) => {
    const [{ buildObjectPickTargets, pickTrackPiece }, { spritePages }] = await Promise.all([
      import('/src/input/object-picking.ts'),
      import('/src/render/sprite-pages.ts'),
    ]);
    const w = window as unknown as Record<string, never>;
    const s = w.__snapshot as unknown as Parameters<typeof buildObjectPickTargets>[0];
    const rect = canvas.getBoundingClientRect();
    const targets = buildObjectPickTargets(s, w.__map, w.__camera, { width: rect.width, height: rect.height }, spritePages);
    let best: { x: number; y: number; pieceId: number } | null = null;
    for (const t of targets) {
      if (t.coasterPart !== 'track' || t.rideId !== 0) continue;
      for (let i = 0; i < t.alpha.length; i += 5) {
        if (!t.alpha[i]) continue;
        const x = t.x + (((i % t.alphaWidth) + 0.5) / t.alphaWidth) * t.width;
        const y = t.y + ((Math.floor(i / t.alphaWidth) + 0.5) / t.alphaHeight) * t.height;
        if (x < 20 || x > rect.width - 20 || y > rect.height - 160) continue;
        if (document.elementFromPoint(rect.left + x, rect.top + y) !== canvas) continue;
        const hit = pickTrackPiece(targets, x, y);
        if (hit && 'pieceId' in hit && hit.pieceId === t.pieceId && (!best || y > best.y))
          best = { x: rect.left + x, y: rect.top + y, pieceId: t.pieceId! };
      }
    }
    return best;
  });
}

for (const [name, viewport] of [
  ['pixel8-portrait', null],
  ['pixel8-landscape', { width: 915, height: 412 }],
] as const) {
  test(`live phone selection ${name}`, async ({ browser }) => {
    const local = await openPage(browser, true);
    if (viewport) await local.setViewportSize(viewport);
    await loadPark(local, LOCAL);
    let zoomOuts = 0;
    let point = await lowRail(local);
    while (!point && zoomOuts < 3) {
      await toolbarAction(local, 'Zoom out');
      await local.waitForTimeout(1_000);
      zoomOuts++;
      point = await lowRail(local);
    }
    expect(point).not.toBeNull();
    await local.context().close();

    const page = await openPage(browser, true);
    if (viewport) await page.setViewportSize(viewport);
    await loadPark(page, LIVE);
    for (let i = 0; i < zoomOuts; i++) {
      await toolbarAction(page, 'Zoom out');
      await page.waitForTimeout(1_000);
    }
    await page.screenshot({ path: `${OUT}/${name}-tap-target.png` });
    await page.touchscreen.tap(point!.x, point!.y);
    await page.getByRole('button', { name: 'Edit from this piece' }).click();
    await expect(page.locator('.coaster-selection-line')).toContainText('Selected piece');
    await expect(page.locator('[data-panel^="ride-"]')).toHaveCount(0);
    await page.waitForTimeout(2_000);
    const outline = (await page.locator('.track-selection-outline').boundingBox())!;
    const sheet = (await page.locator('[data-panel="construction"]').boundingBox())!;
    const clear =
      viewport === null
        ? outline.y + outline.height <= sheet.y
        : outline.x >= sheet.x + sheet.width || outline.x + outline.width <= sheet.x;
    console.log(name, 'tap', point, 'outline', outline, 'sheet', sheet, 'clear', clear,
      await page.locator('.coaster-selection-line').textContent());
    expect(clear).toBe(true);
    for (const b of ['Previous piece', 'Next piece', 'Build piece'])
      await expect(page.getByRole('button', { name: b, exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `${OUT}/${name}-selected.png` });
    await page.getByRole('button', { name: 'Next piece' }).click();
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: `${OUT}/${name}-next.png` });
    await page.context().close();
  });
}
