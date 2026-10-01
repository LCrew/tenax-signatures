import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the API runs on :8085 (npm run preview in /api); Vite proxies everything that isn't the SPA.
const api = { target: 'http://localhost:8085', changeOrigin: false };

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': api, '/assets': api, '/addin': api, '/healthz': api, '/dev': api, '/.well-known': api },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
});
