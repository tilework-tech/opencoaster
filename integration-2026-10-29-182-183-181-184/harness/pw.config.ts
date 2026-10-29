import { defineConfig } from '@playwright/test';
const port = process.env.PORT ?? '4173';
export default defineConfig({
  testDir: '.',
  outputDir: '../playwright-results',
  reporter: 'list',
  timeout: 600_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
});
