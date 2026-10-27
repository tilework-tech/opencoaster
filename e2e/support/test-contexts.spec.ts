import { expect, test } from './test';
import { createTestContext } from './test-contexts';

let contextFromPreviousTest: Awaited<ReturnType<typeof createTestContext>> | undefined;

test('test-owned browser contexts do not carry over to the next test', async ({ browser }) => {
  contextFromPreviousTest = await createTestContext(browser);
  await contextFromPreviousTest.newPage();
});

test('the next test starts without browser contexts from the previous test', async ({
  browser,
}) => {
  expect(contextFromPreviousTest).toBeDefined();
  expect(browser.contexts()).not.toContain(contextFromPreviousTest);
});
