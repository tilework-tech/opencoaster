import { expect, test } from './support/test';
import type { Locator } from './support/test';

async function expectNamed(controls: Locator, what: string): Promise<number> {
  const names = await controls.evaluateAll((nodes) =>
    nodes.map((node) => ({
      title: node.getAttribute('title')?.trim() ?? '',
      label: node.getAttribute('aria-label')?.trim() ?? node.textContent?.trim() ?? '',
    })),
  );
  expect(names.length, `${what} has controls`).toBeGreaterThan(0);
  for (const name of names) {
    expect(name.label, `${what} accessible name`).not.toBe('');
    expect(name.title, `${what} tooltip for ${name.label}`).not.toBe('');
  }
  return names.length;
}

test('every toolbar button and window tab has an accessible name and a tooltip', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  const starterCard = page.locator('.scenario-card').filter({ hasText: 'Starter Park' });
  await starterCard.getByRole('button', { name: 'Start', exact: true }).click();

  const toolbar = page.locator('.game-toolbar');
  await expectNamed(toolbar.locator('button.toolbar-button'), 'toolbar');

  const windowButtons = await toolbar
    .locator('button[data-action]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-action') ?? ''));
  const tabbed: string[] = [];
  for (const action of windowButtons) {
    const button = toolbar.locator(`button[data-action="${action}"]`);
    if (!(await button.isVisible())) continue;
    if (
      [
        'pause',
        'zoom-out',
        'zoom-in',
        'rotate-clockwise',
        'rotate-anticlockwise',
        'save-load',
      ].includes(action)
    )
      continue;
    await button.click();
    const tabs = page.locator('.ui-tabs .ui-tab');
    if ((await tabs.count()) > 0) {
      await expectNamed(tabs, `${action} window tabs`);
      tabbed.push(action);
    }
    await page.keyboard.press('Backspace');
  }
  expect(tabbed.length).toBeGreaterThan(5);
});
