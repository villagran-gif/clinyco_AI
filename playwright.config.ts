import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './Antonia',
  testMatch: '**/*.spec.ts',
  timeout: 120000,
  use: {
    headless: process.env.MEDINET_HEADED !== 'true',
  },
});
