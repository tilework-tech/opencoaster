import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

/**
 * One worker: the WebGL2/Canvas2D specs render in software (SwiftShader), so a second worker
 * takes the CPU the first needs and both start timing out without finishing sooner.
 */
export default defineConfig({
  ...baseConfig,
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  reporter: [['list'], ['./tools/sprites/e2e-spec-timing-reporter.ts']],
  workers: 1,
  webServer: {
    command: 'corepack pnpm exec vite --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
