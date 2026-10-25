import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  clickGameTile,
  createStarterWorld,
  dragThrough,
  findBuildableRun,
  hoverGameTile,
  hudCashCents,
  startStarterPark,
  tileScreenPoint,
  toolbarTool,
} from './footpath-helpers';
import type { Tile } from './footpath-helpers';

const CENTRE: Tile = { x: 28, y: 42 };
const UNOWNED: Tile = { x: 15, y: 40 };
const PATH_COST_CENTS = 1_000;
const REFUSED_REASON = 'You need to own this land before building a footpath.';

/** The pieces the ghost currently draws, as the sim described them in the preview. */
interface GhostPiece {
  tone: string;
  x: number;
  y: number;
  z?: number;
  dir?: number;
  style?: number;
  queue?: boolean;
  edges?: number;
}

async function ghostPieces(page: Page): Promise<GhostPiece[]> {
  return page.$$eval('.path-ghost-tile', (shapes) =>
    shapes.map((shape) => {
      const el = shape as SVGElement;
      const piece: GhostPiece = {
        tone: el.dataset.tone!,
        x: Number(el.dataset.x),
        y: Number(el.dataset.y),
      };
      if (el.dataset.z !== undefined) {
        piece.z = Number(el.dataset.z);
        piece.dir = Number(el.dataset.dir);
        piece.style = Number(el.dataset.style);
        piece.queue = el.dataset.queue === 'true';
        piece.edges = Number(el.dataset.edges);
      }
      return piece;
    }),
  );
}

test.describe('footpath tool (desktop)', () => {
  test('hovering shows the piece under the pointer and its cost, without building it', async ({
    page,
  }) => {
    const world = createStarterWorld();
    const [tile] = findBuildableRun(world, 1, CENTRE);
    await startStarterPark(page);
    await toolbarTool(page, 'Footpaths');
    const before = await hudCashCents(page);

    await hoverGameTile(page, world, tile!);
    await expect(page.locator('.path-ghost-ok')).toHaveCount(1);
    await expect(page.locator('.path-ghost-label')).toHaveText('1 tile · $10.00');
    const [piece] = await ghostPieces(page);
    expect(piece).toMatchObject({ tone: 'ok', x: tile!.x, y: tile!.y, dir: -1, queue: false });

    expect(await hudCashCents(page)).toBe(before);
    await page.mouse.move(2, 2);
    await expect(page.locator('.path-ghost')).toBeHidden();
    expect(await hudCashCents(page)).toBe(before);
  });

  test('dragging previews each piece with its connections, and release lays those pieces', async ({
    page,
  }) => {
    const world = createStarterWorld();
    const run = findBuildableRun(world, 4, CENTRE);
    await startStarterPark(page);
    await toolbarTool(page, 'Footpaths');
    const before = await hudCashCents(page);

    await dragThrough(page, world, run);
    await expect(page.locator('.path-ghost-ok')).toHaveCount(run.length);
    await expect(page.locator('.path-ghost-label')).toHaveText('4 tiles · $40.00');
    const previewed = await ghostPieces(page);
    // Bit 0 joins +x and bit 2 joins -x: the run's ends join one neighbour, its middle two.
    expect(previewed.map((piece) => piece.edges)).toEqual([1, 5, 5, 4]);

    await page.mouse.up();
    await expect(page.locator('.tool-status')).toHaveText('Laid 4 footpath tiles for $40.00.');
    await expect(page.locator('.path-ghost')).toBeHidden();
    await expect.poll(() => hudCashCents(page)).toBe(before - run.length * PATH_COST_CENTS);
  });

  test('a run the player cannot build says why in red and lays nothing', async ({ page }) => {
    const world = createStarterWorld();
    await startStarterPark(page);
    await toolbarTool(page, 'Footpaths');
    const before = await hudCashCents(page);

    await dragThrough(page, world, [{ x: UNOWNED.x - 1, y: UNOWNED.y }, UNOWNED]);
    await expect(page.locator('.path-ghost-refused')).toHaveCount(2);
    await expect(page.locator('.path-ghost-label')).toHaveText(REFUSED_REASON);

    await page.mouse.up();
    await expect(page.locator('.tool-status')).toHaveText(`No footpath laid: ${REFUSED_REASON}`);
    expect(await hudCashCents(page)).toBe(before);
  });

  test('the surface and queue choices change the previewed pieces', async ({ page }) => {
    const world = createStarterWorld();
    const [tile] = findBuildableRun(world, 1, CENTRE);
    await startStarterPark(page);
    await toolbarTool(page, 'Footpaths');

    await page.getByRole('button', { name: 'Dirt', exact: true }).click();
    await expect(page.locator('.tool-status')).toHaveText('Surface: Dirt.');
    await page.getByRole('button', { name: 'Queue line', exact: true }).click();
    await expect(page.locator('.tool-status')).toHaveText('Queue line on.');

    await hoverGameTile(page, world, tile!);
    const [piece] = await ghostPieces(page);
    expect(piece).toMatchObject({ tone: 'ok', style: 2, queue: true });
    await expect(page.locator('.path-ghost-rail')).toHaveCount(2);

    // The surface and queue choices are shared by both tabs, so the piece tab shows them too.
    await page.getByRole('tab', { name: 'Piece by piece' }).click();
    await expect(page.getByRole('button', { name: 'Dirt', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Queue line', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('the remove toggle makes a tap remove a footpath and refunds it', async ({ page }) => {
    const world = createStarterWorld();
    const [tile] = findBuildableRun(world, 1, CENTRE);
    await startStarterPark(page);
    await toolbarTool(page, 'Footpaths');
    const before = await hudCashCents(page);

    await clickGameTile(page, world, tile!);
    await expect.poll(() => hudCashCents(page)).toBe(before - PATH_COST_CENTS);

    await page.getByRole('button', { name: 'Remove footpath', exact: true }).click();
    await expect(page.locator('.tool-status')).toHaveText(
      'Remove footpath: tap a footpath tile to remove it.',
    );
    await clickGameTile(page, world, tile!);
    await expect(page.locator('.tool-status')).toHaveText(
      `Path removal requested at ${tile!.x}, ${tile!.y}.`,
    );
    await expect.poll(() => hudCashCents(page)).toBe(before);
  });

  test('right-click removes a footpath and refunds its cost', async ({ page }) => {
    const world = createStarterWorld();
    const [tile] = findBuildableRun(world, 1, CENTRE);
    await startStarterPark(page);
    await toolbarTool(page, 'Footpaths');
    const before = await hudCashCents(page);

    await clickGameTile(page, world, tile!);
    await expect.poll(() => hudCashCents(page)).toBe(before - PATH_COST_CENTS);

    const [x, y] = await tileScreenPoint(page, world, tile!);
    await page.mouse.click(x, y, { button: 'right' });
    await expect(page.locator('.tool-status')).toHaveText(
      `Path removal requested at ${tile!.x}, ${tile!.y}.`,
    );
    await expect.poll(() => hudCashCents(page)).toBe(before);
  });

  test('the Footpaths window shows its hint the first time only', async ({ page }) => {
    await startStarterPark(page);
    await toolbarTool(page, 'Footpaths');
    await expect(page.locator('.path-hint')).toHaveText(
      'Drag across ground to lay a run; release to build.',
    );

    await toolbarTool(page, 'Footpaths');
    await toolbarTool(page, 'Footpaths');
    await expect(page.getByRole('tab', { name: 'Lay line' })).toBeVisible();
    await expect(page.locator('.path-hint')).toHaveCount(0);
  });

  test('piece mode builds at the cursor, steps on, and removes with a refund', async ({ page }) => {
    const world = createStarterWorld();
    const [tile] = findBuildableRun(world, 1, CENTRE);
    await startStarterPark(page);
    await toolbarTool(page, 'Footpaths');
    const before = await hudCashCents(page);

    await page.getByRole('tab', { name: 'Piece by piece' }).click();
    await clickGameTile(page, world, tile!);
    await expect(page.locator('.tool-status')).toHaveText(`Cursor at ${tile!.x}, ${tile!.y}.`);

    await page.getByRole('button', { name: 'Build', exact: true }).click();
    await expect(page.locator('.tool-status')).toHaveText(
      `Built at ${tile!.x}, ${tile!.y}. Cursor moved to ${tile!.x + 1}, ${tile!.y}.`,
    );
    await expect.poll(() => hudCashCents(page)).toBe(before - PATH_COST_CENTS);

    await clickGameTile(page, world, tile!);
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator('.tool-status')).toHaveText(
      `Removed the footpath at ${tile!.x}, ${tile!.y}.`,
    );
    await expect.poll(() => hudCashCents(page)).toBe(before);
  });

  test('piece direction and slope show in the preview and the status line', async ({ page }) => {
    const world = createStarterWorld();
    const [tile] = findBuildableRun(world, 1, CENTRE);
    await startStarterPark(page);
    await toolbarTool(page, 'Footpaths');
    await page.getByRole('tab', { name: 'Piece by piece' }).click();
    await clickGameTile(page, world, tile!);

    await page.getByRole('button', { name: 'Face +Y' }).click();
    await expect(page.locator('.tool-status')).toHaveText('Facing +Y.');
    await expect(page.getByRole('button', { name: 'Face +Y' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Face +X' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await page.getByRole('button', { name: 'Up', exact: true }).click();
    await expect(page.locator('.tool-status')).toHaveText('Slope: Up.');
    await expect(page.getByRole('button', { name: 'Up', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Level', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // The preview of the cursor piece now rises toward +Y.
    await expect.poll(async () => (await ghostPieces(page))[0]?.dir).toBe(1);
  });

  test('a refused tile shows the reason at the pointer and in the status line', async ({
    page,
  }) => {
    const world = createStarterWorld();
    await startStarterPark(page);
    await toolbarTool(page, 'Footpaths');
    await hoverGameTile(page, world, UNOWNED);
    await expect(page.locator('.path-ghost-refused')).toHaveCount(1);
    await expect(page.locator('.path-ghost-label')).toHaveText(REFUSED_REASON);

    await clickGameTile(page, world, UNOWNED);
    await expect(page.locator('.tool-status')).toHaveText(`No footpath laid: ${REFUSED_REASON}`);
  });
});

test.describe('footpath tool (Pixel-class touch)', () => {
  test.use({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
  });

  test('dragging with a finger previews the run under it and lays it on release', async ({
    page,
  }) => {
    const world = createStarterWorld();
    const run = findBuildableRun(world, 3, CENTRE);
    await startStarterPark(page);
    await toolbarTool(page, 'Footpaths');
    const before = await hudCashCents(page);

    const session = await page.context().newCDPSession(page);
    const [startX, startY] = await tileScreenPoint(page, world, run[0]!);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: startX, y: startY }],
    });
    for (const tile of run.slice(1)) {
      const [x, y] = await tileScreenPoint(page, world, tile);
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y }],
      });
    }
    await expect(page.locator('.path-ghost-ok')).toHaveCount(run.length);
    await expect(page.locator('.path-ghost-label')).toHaveText('3 tiles · $30.00');

    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.tool-status')).toHaveText('Laid 3 footpath tiles for $30.00.');
    await expect(page.locator('.path-ghost')).toBeHidden();
    await expect.poll(() => hudCashCents(page)).toBe(before - run.length * PATH_COST_CENTS);
  });

  test('a long press on a footpath removes it and refunds the cost', async ({ page }) => {
    const world = createStarterWorld();
    const [tile] = findBuildableRun(world, 1, CENTRE);
    await startStarterPark(page);
    await toolbarTool(page, 'Footpaths');
    const before = await hudCashCents(page);

    const [x, y] = await tileScreenPoint(page, world, tile!);
    await page.touchscreen.tap(x, y);
    await expect.poll(() => hudCashCents(page)).toBe(before - PATH_COST_CENTS);

    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    await page.waitForTimeout(1200);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.tool-status')).toHaveText(
      `Path removal requested at ${tile!.x}, ${tile!.y}.`,
    );
    await expect.poll(() => hudCashCents(page)).toBe(before);
  });
});
