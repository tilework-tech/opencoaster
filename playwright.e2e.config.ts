import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

/** One worker keeps SwiftShader contention low; concurrent renderer tests time out even at two. */
export default defineConfig({
  ...baseConfig,
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  reporter: [['list'], ['./tools/sprites/e2e-spec-timing-reporter.ts']],
  workers: 1,
  webServer: undefined,
});
