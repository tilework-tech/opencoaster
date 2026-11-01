import { mkdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { test } from '@playwright/test';
import type { Page, PageScreenshotOptions } from '@playwright/test';

/**
 * Screenshots the page into the test's output directory. With `UPDATE_SCREENSHOTS=1` it writes
 * the committed copy at `committedPath` (relative to the repository root) instead, so ordinary
 * test runs leave the working tree unchanged.
 */
export async function docsScreenshot(
  page: Page,
  committedPath: string,
  options: Omit<PageScreenshotOptions, 'path'> = {},
): Promise<void> {
  if (process.env.UPDATE_SCREENSHOTS) {
    await mkdir(dirname(committedPath), { recursive: true });
    await page.screenshot({ ...options, path: committedPath });
  } else {
    await page.screenshot({ ...options, path: test.info().outputPath(basename(committedPath)) });
  }
}
