import { defineConfig } from '@playwright/test';

const port = 4174;
const prefix = '/opencoaster/';

// Runs the smoke suite against the production build served under a subpath with no
// cross-origin isolation headers, matching how GitHub Pages serves the game.
export default defineConfig({
  testDir: './smoke',
  outputDir: './.local/playwright-results-subpath',
  reporter: 'list',
  timeout: 45_000,
  use: {
    baseURL: `http://127.0.0.1:${port}${prefix}`,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: `node tools/serve-subpath.mjs dist ${port} ${prefix}`,
    url: `http://127.0.0.1:${port}${prefix}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
