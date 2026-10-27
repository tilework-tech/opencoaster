import { expect, test } from './support/test';

test('keeps toolbar controls clickable above open information windows', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  const starterCard = page.locator('.scenario-card').filter({ hasText: 'Starter Park' });
  await starterCard.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Staff' }).click();

  const options = page.getByRole('button', { name: 'Game options' });
  const receivesPointer = await options.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const topElement = document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
    );
    return {
      receivesPointer: topElement === element || element.contains(topElement),
      hit:
        topElement instanceof HTMLElement ? `${topElement.tagName}.${topElement.className}` : null,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    };
  });

  expect(receivesPointer.receivesPointer, JSON.stringify(receivesPointer)).toBe(true);
});
