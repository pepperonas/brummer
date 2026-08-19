import { defineConfig } from 'vite';
export default defineConfig({
  base: '/',
  build: { outDir: 'dist', assetsDir: 'assets', target: 'es2020', sourcemap: false },
  server: { port: 5180, proxy: {
    '/api': 'http://127.0.0.1:4263',
    '/ws':  { target: 'ws://127.0.0.1:4263', ws: true },
  } },
});
