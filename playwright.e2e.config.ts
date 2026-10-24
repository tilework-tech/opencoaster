import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

export default defineConfig({ ...baseConfig, testDir: './e2e' });
