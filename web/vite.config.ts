import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': process.env.API_PROXY_TARGET || 'http://localhost:8080',
      '/health': process.env.API_PROXY_TARGET || 'http://localhost:8080',
    },
  },
});
