import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

export default defineConfig({
  ...baseConfig,
  testDir: './e2e',
  outputDir: './.local/playwright-art-review',
  timeout: 600_000,
  expect: { timeout: 60_000 },
  workers: 1,
});
