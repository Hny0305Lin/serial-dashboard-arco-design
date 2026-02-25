import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  integrations: [react()],
  vite: {
    resolve: {
      alias: {
        '~nprogress': 'nprogress',
      }
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:9001',
          changeOrigin: true
        },
        '/ws': {
          target: 'ws://127.0.0.1:9001',
          ws: true,
          changeOrigin: true
        }
      }
    },
  },
  server: {
    port: 9000,
  }
});
