import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

if (!process.env.WEB_PORT) process.env.WEB_PORT = '4321';
const webPort = Number(process.env.WEB_PORT) || 4321;
const webCwd = process.cwd().endsWith(`${path.sep}web`) ? process.cwd() : path.join(process.cwd(), 'web');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `node node_modules/astro/astro.js dev --host 127.0.0.1 --port ${webPort}`,
    url: `http://127.0.0.1:${webPort}/`,
    cwd: webCwd,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'edge',
      use: { ...devices['Desktop Chrome'], channel: 'msedge' },
    },
  ],
});
