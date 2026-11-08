import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';

export default defineConfig({
  plugins: [vue()],
  define: { __APP_VERSION__: JSON.stringify('v' + readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim()) },
  base: '/web/',
  build: {
    outDir: '../server/src/public/web-dist',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    target: 'es2022',
  },
});
