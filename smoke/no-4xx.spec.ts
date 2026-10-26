import { expect, test } from '@playwright/test';

const SKIPPED_ACTIONS = /^(Game options|Actions|Pause|Play|Fast|Faster|Rotate|Zoom)/;

test('no network request answers with a 4xx while the game and its windows load', async ({
  page,
}) => {
  const clientErrors: string[] = [];
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400 && status < 500) clientErrors.push(`${status} ${response.url()}`);
  });

  await page.goto('./');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  const toolbar = page.locator('.game-toolbar');
  await expect(toolbar).toBeVisible();

  const names = (await toolbar
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent ?? ''),
    )) as string[];
  for (const name of names.filter((n) => n && !SKIPPED_ACTIONS.test(n))) {
    const action = toolbar.getByRole('button', { name, exact: true });
    if (await action.isVisible()) await action.click();
    await page.keyboard.press('Shift+Backspace');
  }

  await page.waitForLoadState('networkidle');
  expect(clientErrors).toEqual([]);
});
