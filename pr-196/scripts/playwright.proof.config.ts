import { defineConfig } from '@playwright/test';

/** Before/after captures: PROOF_URL selects the server (main or the branch), PROOF_OUT the folder. */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.proof\.ts/,
  outputDir: './out/results',
  reporter: 'list',
  timeout: 300_000,
  workers: 1,
  use: {
    baseURL: process.env.PROOF_URL ?? 'http://127.0.0.1:4173',
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
});
