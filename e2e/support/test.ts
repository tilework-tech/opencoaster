import { test as base } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { closeTestContexts } from './test-contexts';

export * from '@playwright/test';

export const test = base.extend<{ cleanupCreatedContexts: void; freshBrowser: Browser }>({
  freshBrowser: [
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
  context: async ({ freshBrowser, contextOptions }, use) => {
    const context: BrowserContext = await freshBrowser.newContext(contextOptions);
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
  page: async ({ context }, use) => {
    const page: Page = await context.newPage();
    await use(page);
  },
  cleanupCreatedContexts: [
    async ({ freshBrowser }, use) => {
      await use();
      await closeTestContexts(freshBrowser);
    },
    { auto: true },
  ],
});
