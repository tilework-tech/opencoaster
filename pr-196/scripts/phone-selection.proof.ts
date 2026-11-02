import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { openPage, toolbarAction } from '../../e2e/support/park';
import { trackEditPark } from '../../e2e/support/track-edit-park';

const OUT = process.env.PROOF_OUT ?? 'out/after';

async function loadPark(page: Page): Promise<void> {
  const savePath = `${OUT}/track-edit.ocsave`;
  await mkdir(OUT, { recursive: true });
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
        const s = (window as unknown as { __snapshot?: { tracks: { count: number } } }).__snapshot;
        return s ? s.tracks.count : 0;
      }),
    )
    .toBe(27);
}

/** Centres the 7th piece of the circuit on the open map and returns a rail point on it. */
async function middleRail(page: Page): Promise<{ x: number; y: number }> {
  const find = () =>
    page.locator('#game').evaluate(async (canvas) => {
      const [{ buildObjectPickTargets, pickTrackPiece }, { spritePages }] = await Promise.all([
        import('/src/input/object-picking.ts'),
        import('/src/render/sprite-pages.ts'),
      ]);
      const w = window as unknown as {
        __camera: { x: number; y: number; zoom: number };
        __map: Parameters<typeof buildObjectPickTargets>[1];
        __snapshot: Parameters<typeof buildObjectPickTargets>[0] & {
          tracks: { count: number; data: Int32Array };
          trackLinks: Int32Array;
        };
      };
      const s = w.__snapshot;
      if (!s || !s.trackLinks.length) return null;
      const rows: Array<{ id: number; prev: number; next: number; type: number }> = [];
      for (let i = 0; i < s.tracks.count; i++) {
        const word = s.tracks.data[i * 4 + 3];
        if (word >>> 16 !== 0) continue;
        rows.push({ id: s.trackLinks[i * 3], prev: s.trackLinks[i * 3 + 1], next: s.trackLinks[i * 3 + 2], type: word & 0xff });
      }
      const byId = new Map(rows.map((r) => [r.id, r]));
      let at = rows.find((r) => r.type === 0)!;
      for (let i = 0; i < 6; i++) at = byId.get(at.next)!;
      const pieceId = at.id;
      const rect = canvas.getBoundingClientRect();
      const viewport = { width: rect.width, height: rect.height };
      const mine = (t: { coasterPart?: string; pieceId?: number }) =>
        t.coasterPart === 'track' && t.pieceId === pieceId;
      w.__camera.zoom = 2;
      let targets = buildObjectPickTargets(s, w.__map, w.__camera as never, viewport, spritePages);
      const first = targets.find(mine);
      if (!first) return null;
      w.__camera.x += (first.x + first.width / 2 - viewport.width / 2) / 2;
      w.__camera.y += (first.y + first.height / 2 - viewport.height / 2) / 2;
      targets = buildObjectPickTargets(s, w.__map, w.__camera as never, viewport, spritePages);
      for (const t of targets.filter(mine))
        for (let i = 0; i < t.alpha.length; i += 3) {
          if (!t.alpha[i]) continue;
          const x = t.x + (((i % t.alphaWidth) + 0.5) / t.alphaWidth) * t.width;
          const y = t.y + ((Math.floor(i / t.alphaWidth) + 0.5) / t.alphaHeight) * t.height;
          const hit = pickTrackPiece(targets, x, y);
          if (hit && 'pieceId' in hit && hit.pieceId === pieceId && document.elementFromPoint(rect.left + x, rect.top + y) === canvas)
            return { x: rect.left + x, y: rect.top + y };
        }
      return null;
    });
  await expect.poll(find, { timeout: 30_000 }).not.toBeNull();
  return (await find())!;
}

for (const [name, viewport] of [
  ['pixel8-portrait', null],
  ['pixel8-landscape', { width: 915, height: 412 }],
] as const) {
  test(`phone selection ${name}`, async ({ browser }) => {
    const page = await openPage(browser, true);
    if (viewport) await page.setViewportSize(viewport);
    await loadPark(page);
    await toolbarAction(page, 'Pause');
    const point = await middleRail(page);
    await page.touchscreen.tap(point.x, point.y);
    await page.getByRole('button', { name: 'Edit from this piece' }).click();
    await expect(page.locator('.coaster-selection-line')).toContainText('Selected piece 7 of 14');
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: `${OUT}/${name}-selected.png` });
    await page.getByRole('button', { name: 'Next piece' }).click();
    await expect(page.locator('.coaster-selection-line')).toContainText('Selected piece 8 of 14');
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: `${OUT}/${name}-next.png` });
    await page.context().close();
  });
}
