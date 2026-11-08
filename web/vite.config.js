import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  base: '/web/',
  build: {
    outDir: '../server/src/public/web-dist',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    target: 'es2022',
  },
});
