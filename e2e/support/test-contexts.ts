import type { Browser, BrowserContext, BrowserContextOptions } from '@playwright/test';

const contextsByBrowser = new WeakMap<Browser, Set<BrowserContext>>();

export async function createTestContext(
  browser: Browser,
  options?: BrowserContextOptions,
): Promise<BrowserContext> {
  const context = await browser.newContext(options);
  let contexts = contextsByBrowser.get(browser);
  if (!contexts) {
    contexts = new Set();
    contextsByBrowser.set(browser, contexts);
  }
  contexts.add(context);
  context.on('close', () => contexts?.delete(context));
  return context;
}

export async function closeTestContexts(browser: Browser): Promise<void> {
  const contexts = contextsByBrowser.get(browser);
  if (!contexts) return;
  await Promise.all([...contexts].map((context) => context.close()));
  contexts.clear();
}
