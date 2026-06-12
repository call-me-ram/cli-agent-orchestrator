import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 360_000, // live agent runs take minutes
  expect: { timeout: 30_000 },
  use: {
    baseURL: 'http://localhost:9889',
    screenshot: 'only-on-failure',
  },
  reporter: [['list']],
  workers: 1, // live runs share one cao-server; keep them serial
})
