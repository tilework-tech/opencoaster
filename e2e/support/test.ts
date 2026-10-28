import { test as base } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { closeTestContexts } from './test-contexts';

export * from '@playwright/test';

export const test = base.extend<{ cleanupCreatedContexts: void }, { browser: Browser }>({
  browser: [
    async ({ browserName, playwright }, use, testInfo) => {
      const browserType = playwright[browserName];
      const options = testInfo.project.use.launchOptions as Parameters<
        typeof browserType.launch
      >[0];
      const browser = await browserType.launch(options);
      try {
        await use(browser);
      } finally {
        await closeTestContexts(browser);
        await browser.close();
      }
    },
    { scope: 'test' },
  ],
  cleanupCreatedContexts: [
    async ({ browser }, use) => {
      await use();
      await closeTestContexts(browser);
    },
    { auto: true },
  ],
});
