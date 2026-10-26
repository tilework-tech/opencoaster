import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { openPage, startStarterPark, toolbarAction } from './support/park';

async function startPark(browser: Browser, mobile: boolean): Promise<Page> {
  const page = await openPage(browser, mobile);
  await startStarterPark(page);
  return page;
}

async function spawnGuestMilestone(page: Page, count: number): Promise<void> {
  const options = page.locator('[data-panel="options"]');
  if (!(await options.isVisible())) await toolbarAction(page, 'Game options');
  await options.getByRole('tab', { name: 'Game' }).click();
  await options.getByRole('button', { name: 'Guests +1,000' }).click();
  await expect(page.locator('.status-ticker')).toContainText(`Your park now has ${count} guests`);
}

async function queueGuestMilestone(page: Page): Promise<void> {
  const options = page.locator('[data-panel="options"]');
  if (!(await options.isVisible())) await toolbarAction(page, 'Game options');
  await options.getByRole('tab', { name: 'Game' }).click();
  await options.getByRole('button', { name: 'Guests +1,000' }).click();
}

async function swipeTicker(page: Page): Promise<void> {
  const ticker = page.locator('.status-ticker');
  const rect = await ticker.boundingBox();
  if (!rect) throw new Error('Message ticker is not visible');
  const cdp = await page.context().newCDPSession(page);
  const y = rect.y + rect.height / 2;
  const startX = rect.x + rect.width * 0.8;
  const endX = rect.x + rect.width * 0.2;
  const touch = (x: number) => ({ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [touch(startX)],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [touch(endX)],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function exerciseMessages(browser: Browser, mobile: boolean): Promise<void> {
  const page = await startPark(browser, mobile);
  try {
    const ticker = page.locator('.status-ticker');
    await spawnGuestMilestone(page, 1_000);
    await queueGuestMilestone(page);
    await expect(ticker).toContainText('Your park now has 1000 guests');

    const dismiss = page.getByRole('button', { name: 'Dismiss message' });
    await expect(dismiss).toBeVisible();
    await dismiss.click();
    await expect(ticker).toContainText('Your park now has 2000 guests');

    await page.keyboard.press('q');
    await expect(ticker).toHaveText('Welcome to your park');

    await spawnGuestMilestone(page, 3_000);
    if (mobile) {
      await swipeTicker(page);
      await expect(ticker).toHaveText('Welcome to your park');
      await expect(page.locator('[data-panel="news"]')).toHaveCount(0);
    } else {
      await page.keyboard.press('q');
      await expect(ticker).toHaveText('Welcome to your park');
    }

    await page.getByRole('button', { name: 'Recent messages' }).click();
    const recent = page.locator('[data-panel="news"]');
    await expect(recent).toContainText('Your park now has 3000 guests');
    await expect(recent.getByRole('button', { name: 'Clear all' })).toBeEnabled();
    await recent.getByRole('button', { name: 'Clear all' }).click();
    await expect(recent).toContainText('No messages yet.');
    await recent.getByRole('button', { name: 'Close Recent messages' }).click();

    const options = page.locator('[data-panel="options"]');
    if (mobile && (await options.evaluate((el) => el.classList.contains('collapsed')))) {
      await options.locator('.ui-title').click();
    }
    if (!(await options.isVisible())) await toolbarAction(page, 'Game options');
    await options.getByRole('tab', { name: 'Messages' }).click();
    const guestFilter = options.getByRole('checkbox', { name: 'Guest milestones' });
    await expect(guestFilter).toBeChecked();
    await expect(options.getByRole('checkbox', { name: 'Marketing' })).toHaveCount(0);
    await expect(options.getByRole('checkbox', { name: 'Research' })).toHaveCount(0);
    await options.getByRole('tab', { name: 'Controls' }).click();
    await expect(options).toContainText('Q dismisses the current message');
    await options.getByRole('tab', { name: 'Messages' }).click();
    await guestFilter.uncheck();
    await options.getByRole('tab', { name: 'Game' }).click();
    await options.getByRole('button', { name: 'Guests +1,000' }).click();
    await expect(ticker).toHaveText('Welcome to your park');

    await options.getByRole('tab', { name: 'Messages' }).click();
    await expect(options.getByRole('checkbox', { name: 'Guest milestones' })).not.toBeChecked();
    await page.getByRole('button', { name: 'Recent messages' }).click();
    await expect(recent).toContainText('No messages yet.');
  } finally {
    await page.context().close();
  }
}

test('desktop message queue supports dismiss, history, clearing and category filters', async ({
  browser,
}) => {
  await exerciseMessages(browser, false);
});

test('Pixel 8 message queue supports dismiss, swipe, history, clearing and category filters', async ({
  browser,
}) => {
  await exerciseMessages(browser, true);
});
