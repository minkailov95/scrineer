import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:5000', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
