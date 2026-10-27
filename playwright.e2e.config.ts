import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

/**
 * One worker: the WebGL2/Canvas2D specs render in software (SwiftShader), so a second worker
 * takes the CPU the first needs and both start timing out without finishing sooner.
 */
export default defineConfig({ ...baseConfig, testDir: './e2e', workers: 1 });
