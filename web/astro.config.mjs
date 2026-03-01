import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

const backendPort = (() => {
  const n = Number(String(process.env.BACKEND_PORT || process.env.PUBLIC_BACKEND_PORT || '').trim());
  if (Number.isFinite(n) && n > 0) return n;
  return 9011;
})();

const webPort = (() => {
  const n = Number(String(process.env.WEB_PORT || '').trim());
  if (Number.isFinite(n) && n > 0) return n;
  return 9010;
})();

export default defineConfig({
  integrations: [react()],
  vite: {
    resolve: {
      alias: {
        '~nprogress': 'nprogress',
      }
    },
    server: {
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${backendPort}`,
          changeOrigin: true
        },
        '/ws': {
          target: `ws://127.0.0.1:${backendPort}`,
          ws: true,
          changeOrigin: true
        }
      }
    },
  },
  server: {
    port: webPort,
  }
});
