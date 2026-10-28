import { test as base } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { closeTestContexts } from './test-contexts';
import { SpecBrowserPool } from './spec-browser-pool';

const specBrowsers = new SpecBrowserPool<Browser>();

export * from '@playwright/test';

export const test = base.extend<{ freshBrowser: Browser }, { closeSpecBrowser: void }>({
  closeSpecBrowser: [
    async (_fixtures, use) => {
      await use();
      await specBrowsers.close();
    },
    { scope: 'worker', auto: true },
  ],
  freshBrowser: async ({ browserName, playwright }, use, testInfo) => {
    const browserType = playwright[browserName];
    const options = testInfo.project.use.launchOptions as Parameters<typeof browserType.launch>[0];
    const browser = await specBrowsers.acquire(testInfo.file, () => browserType.launch(options));
    try {
      await use(browser);
    } finally {
      await closeTestContexts(browser);
      await Promise.all(browser.contexts().map((context) => context.close()));
    }
  },
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
});
