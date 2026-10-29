import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from './support/test';
import type { Page } from './support/test';
import { serialize } from '../src/save/save';
import { createRide } from '../src/sim/rides/ride-operations';
import { RIDE_CATALOG } from '../src/sim/rides/ride-types';
import { parseScenarioFile } from '../src/sim/scenario/scenario-file';
import { prepareScenario } from '../src/sim/scenario/scenario-layout';
import { World } from '../src/sim/core/world';
import { openPage, startStarterPark, toolbarAction } from './support/park';

const TABS = [
  'Transport rides',
  'Roller Coasters',
  'Gentle rides',
  'Thrill rides',
  'Water rides',
  'Shops & Stalls',
];

const REPRESENTATIVE_RIDES = Object.values(RIDE_CATALOG).filter(
  (ride, index, rides) =>
    rides.findIndex((candidate) => candidate.category === ride.category) === index,
);

/** Opaque pixels a recognisable ride, stall or toilet block covers on any preview canvas. */
const MIN_OPAQUE_PIXELS = 1200;
/** A preview must keep this much transparent border so no sprite is cut off by the canvas edge. */
const EDGE_BAND = 2;

interface PreviewReading {
  opaque: number;
  edgeOpaque: number;
  width: number;
  height: number;
  cssWidth: number;
  cssHeight: number;
}

function representativeRidesSave(): string {
  const scenario = parseScenarioFile(
    JSON.parse(
      readFileSync(new URL('../src/sim/scenario/scenarios/starter.json', import.meta.url), 'utf8'),
    ),
  );
  const world = new World({
    seed: scenario.seed,
    width: scenario.mapWidth,
    height: scenario.mapHeight,
  });
  prepareScenario(world, scenario);
  REPRESENTATIVE_RIDES.forEach((def, index) => {
    world.research.unlocked.add(def.id);
    createRide(world, def.id, 4 + (index % 6) * 5, 4 + Math.floor(index / 6) * 5, 0);
  });
  return serialize(world);
}

/** Pixels of a preview canvas that are drawn, and how many of them touch its outer band. */
function readPreview(canvas: HTMLCanvasElement, band: number): PreviewReading {
  const context = canvas.getContext('2d')!;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let opaque = 0;
  let edgeOpaque = 0;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] === 0) continue;
      opaque++;
      if (x < band || y < band || x >= canvas.width - band || y >= canvas.height - band)
        edgeOpaque++;
    }
  }
  const box = canvas.getBoundingClientRect();
  return {
    opaque,
    edgeOpaque,
    width: canvas.width,
    height: canvas.height,
    cssWidth: box.width,
    cssHeight: box.height,
  };
}

function expectWholePreview(name: string, reading: PreviewReading, minOpaque: number): void {
  expect(reading.opaque, `${name} opaque pixels`).toBeGreaterThanOrEqual(minOpaque);
  expect(reading.edgeOpaque, `${name} pixels on the canvas edge`).toBe(0);
  const drawn = reading.width / reading.height;
  const shown = reading.cssWidth / reading.cssHeight;
  expect(Math.abs(drawn - shown) / drawn, `${name} aspect ratio`).toBeLessThan(0.03);
}

async function tap(page: Page, mobile: boolean, locator: ReturnType<Page['locator']>) {
  if (mobile) await locator.tap();
  else await locator.click();
}

test('ride, stall and facility previews are whole and undistorted (desktop)', async ({
  freshBrowser: browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const page = await openPage(browser, false);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (/webgl/.test(type)) return null;
      return original.call(this, type as '2d', ...(args as []));
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await startStarterPark(page);
  const savePath = testInfo.outputPath('all-rides.park');
  await mkdir(dirname(savePath), { recursive: true });
  await writeFile(savePath, representativeRidesSave());
  await toolbarAction(page, 'Save / Load');
  await tap(page, false, page.getByRole('button', { name: 'Import save file' }));
  await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
  await expect(page.locator('.hud')).toContainText('tick');

  await toolbarAction(page, 'New ride');
  const select = page.getByRole('group', { name: 'New attraction' });
  for (const tab of TABS) {
    await tap(page, false, page.getByRole('tab', { name: tab }));
    const cards = select.locator('.ui-pane.active .ride-card:visible');
    const count = await cards.count();
    expect(count, `${tab} cards`).toBeGreaterThan(0);
    await expect
      .poll(() => cards.locator('.ride-card-thumbnail[data-preview]').count(), {
        timeout: 30_000,
        message: `${tab} has a rendered ride thumbnail`,
      })
      .toBeGreaterThan(0);
    const thumbnail = cards.locator('.ride-card-thumbnail[data-preview]').first();
    const name =
      (await thumbnail.evaluate((canvas) =>
        canvas.closest<HTMLElement>('.ride-card')?.getAttribute('aria-label'),
      )) ?? tab;
    let reading = await thumbnail.evaluate(readPreview, EDGE_BAND);
    if (reading.opaque < 100) {
      const stamp = await thumbnail.getAttribute('data-preview');
      await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
      await expect(thumbnail).not.toHaveAttribute('data-preview', stamp!);
      await expect
        .poll(async () => (await thumbnail.evaluate(readPreview, EDGE_BAND)).opaque, {
          timeout: 30_000,
          message: `${name} thumbnail pixels rendered after redraw`,
        })
        .toBeGreaterThanOrEqual(100);
      reading = await thumbnail.evaluate(readPreview, EDGE_BAND);
    }
    expectWholePreview(`${name} thumbnail`, reading, 100);
  }

  await page.getByRole('button', { name: 'Ride list' }).click();
  await expect(page.locator('.ride-list .list-row')).toHaveCount(REPRESENTATIVE_RIDES.length);
  const rides = await page.locator('.ride-list .list-row').evaluateAll((rows) =>
    rows.map((row) => ({
      id: (row as HTMLElement).dataset.rideId!,
      name: row.querySelector('.list-name')!.textContent!,
    })),
  );
  expect(rides).toHaveLength(REPRESENTATIVE_RIDES.length);
  for (const ride of rides) {
    await page.evaluate((id) => {
      document.querySelector<HTMLElement>(`.list-row[data-ride-id="${id}"]`)!.click();
    }, ride.id);
    const window = page.locator('.ui-window').filter({ has: page.locator('.ride-preview') });
    const preview = window.locator('.ride-preview');
    await expect(window.locator('.ui-title')).toContainText(ride.name.replace(/ \d+$/, ''));
    await expect
      .poll(async () => (await preview.evaluate(readPreview, EDGE_BAND)).opaque, {
        message: `${ride.name} preview drawn`,
        timeout: 90_000,
      })
      .toBeGreaterThanOrEqual(MIN_OPAQUE_PIXELS);
    const reading = await preview.evaluate(readPreview, EDGE_BAND);
    expectWholePreview(ride.name, reading, MIN_OPAQUE_PIXELS);
    expect(reading.cssWidth / reading.cssHeight, `${ride.name} displayed ratio`).toBeCloseTo(2, 1);
    await window
      .getByRole('button', { name: /^Close/ })
      .first()
      .click();
  }
  await page.context().close();
});
