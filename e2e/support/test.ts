import { test as base } from '@playwright/test';
import { closeTestContexts } from './test-contexts';

export * from '@playwright/test';

export const test = base.extend<{ cleanupCreatedContexts: void }>({
  cleanupCreatedContexts: [
    async ({ browser }, use) => {
      await use();
      await closeTestContexts(browser);
    },
    { auto: true },
  ],
});
