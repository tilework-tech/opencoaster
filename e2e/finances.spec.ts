import { copyFileSync, mkdirSync } from 'node:fs';
import { expect, test } from './support/test';
import type { Page } from './support/test';
import { startStarterPark } from './support/footprints';
import { toolbarTool } from './footpath-helpers';

const proofDir = process.env.FINANCE_PROOF_DIR;
const healthySave = process.env.FINANCE_SAVE;
const strainedSave = process.env.FINANCE_STRAINED_SAVE;

test.use({
  launchOptions: {
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
    ],
  },
});

interface SimWindow {
  __sim: { setSpeed(multiplier: number): void };
}

async function openFinances(page: Page): Promise<void> {
  await page
    .locator('.game-toolbar')
    .getByRole('button', { name: 'Finances', exact: true })
    .click();
}

async function importSave(page: Page, path: string, name: string, outputDir: string) {
  const importPath = `${outputDir}/${name}.park`;
  mkdirSync(outputDir, { recursive: true });
  copyFileSync(path, importPath);
  await toolbarTool(page, 'Save / Load');
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(importPath);
  await expect(page.locator('.hud')).toContainText('tick');
  await page.keyboard.press('Escape');
}

test('the Finances window lists the loan terms, the weekly bills and five months of history', async ({
  page,
}) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  await startStarterPark(page);
  await openFinances(page);
  const finance = page.locator('[data-panel="finance"]');
  await expect(finance).toContainText('10.0% a year');
  await expect(finance).toContainText('Weekly bills');
  await expect(finance.locator('.ledger-table th', { hasText: 'This month' })).toBeVisible();
  await expect(finance.locator('.ledger-table th', { hasText: '5 mo ago' })).toBeVisible();
  await expect(finance.getByRole('button', { name: 'Borrow $1,000' })).toBeEnabled();
});

test('proof: Finances window over a scripted starter park', async ({ page }, testInfo) => {
  test.skip(!proofDir || !healthySave || !strainedSave, 'set FINANCE_PROOF_DIR and the saves');
  test.setTimeout(900_000);
  mkdirSync(proofDir!, { recursive: true });
  if (process.env.CANVAS2D === '1')
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
        if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
        return original.call(this, type as '2d', ...(args as []));
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
  await startStarterPark(page);
  await importSave(page, healthySave!, 'healthy', testInfo.outputDir);
  await page.evaluate(() => (window as unknown as SimWindow).__sim.setSpeed(4));
  await page.waitForTimeout(45_000);
  await openFinances(page);
  const finance = page.locator('[data-panel="finance"]');
  await finance.screenshot({ path: `${proofDir}/finances-summary.png` });
  await page.screenshot({ path: `${proofDir}/finances-summary-page.png` });
  await page.getByRole('tab', { name: 'Cash graph' }).click();
  await page.waitForTimeout(500);
  await finance.screenshot({ path: `${proofDir}/finances-cash-graph.png` });

  await page.reload();
  await startStarterPark(page);
  await importSave(page, strainedSave!, 'strained', testInfo.outputDir);
  await openFinances(page);
  await expect(page.locator('.finance-outlook')).toBeVisible();
  await finance.screenshot({ path: `${proofDir}/finances-low-cash.png` });
});
