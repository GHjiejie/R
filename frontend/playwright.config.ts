import { existsSync } from 'node:fs'
import { defineConfig } from '@playwright/test'

const baseURL = 'http://127.0.0.1:5193'
const channel = process.env.PLAYWRIGHT_CHANNEL || (
  process.platform === 'darwin' && existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined
)

export default defineConfig({
  testDir: './tests',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    channel,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --strictPort',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
