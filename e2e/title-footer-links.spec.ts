import { devices, expect, test } from './support/test';
import type { Locator, Page } from '@playwright/test';
import { createTestContext } from './support/test-contexts';

const FOOTER_LINKS = [
  { name: /Built with Nori.*\(opens in a new tab\)/, href: 'https://noriagentic.com/' },
  {
    name: /Why and how we built OpenCoaster.*\(opens in a new tab\)/,
    href: 'https://12gramsofcarbon.com/p/agentics-its-never-been-easier-to',
  },
  {
    name: /Source on GitHub.*\(opens in a new tab\)/,
    href: 'https://github.com/tilework-tech/opencoaster',
  },
];

const MENU_BUTTONS = ['New game', 'Sandbox', 'Continue', 'Load game', 'Import save file'];

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function expectFooterLinksBesideMenu(page: Page, minTargetHeight: number): Promise<void> {
  await expect(page.getByRole('heading', { name: 'OpenCoaster' })).toBeVisible();
  const linkBoxes: Box[] = [];
  for (const { name, href } of FOOTER_LINKS) {
    const link = page.getByRole('link', { name });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    const rel = (await link.getAttribute('rel')) ?? '';
    expect(rel.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
    await expect(link).toBeInViewport({ ratio: 1 });
    const box = await boxOf(link);
    expect(box.height, `${name} touch target`).toBeGreaterThanOrEqual(minTargetHeight);
    linkBoxes.push(box);
  }
  for (let i = 0; i < linkBoxes.length; i++) {
    for (let j = i + 1; j < linkBoxes.length; j++) {
      expect(overlaps(linkBoxes[i]!, linkBoxes[j]!), 'footer links overlap').toBe(false);
    }
  }
  for (const name of MENU_BUTTONS) {
    const buttonBox = await boxOf(page.getByRole('button', { name, exact: true }));
    for (const linkBox of linkBoxes) {
      expect(overlaps(linkBox, buttonBox), `a footer link overlaps ${name}`).toBe(false);
    }
  }
}

test('the title screen footer links to Nori, the build story and the source on desktop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expectFooterLinksBesideMenu(page, 24);

  for (const { name } of FOOTER_LINKS) {
    const link = page.getByRole('link', { name });
    for (let i = 0; i < 16 && !(await link.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press('Tab');
    }
    await expect(link).toBeFocused();
  }

  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expectFooterLinksBesideMenu(page, 24);

  await page.getByRole('button', { name: 'Load game', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expectFooterLinksBesideMenu(page, 24);
});

for (const device of ['Pixel 8', 'iPhone SE'] as const) {
  test(`the title screen footer links fit beside the menu on ${device}`, async ({ browser }) => {
    const { defaultBrowserType: _browserType, ...options } = devices[device];
    void _browserType;
    const context = await createTestContext(browser, options);
    const page = await context.newPage();
    await page.goto('/');
    await expectFooterLinksBesideMenu(page, 44);
  });
}
