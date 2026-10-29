import { defineConfig } from '@playwright/test';
import e2eConfig from './playwright.e2e.config';

/** Bench-use proof runs: WebGL2 in software with the shared-memory workaround for small sandboxes. */
export default defineConfig({
  ...e2eConfig,
  use: {
    ...e2eConfig.use,
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-dev-shm-usage',
      ],
    },
  },
});
