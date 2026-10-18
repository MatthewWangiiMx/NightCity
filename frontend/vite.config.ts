import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // 127.0.0.1, not localhost: on Windows localhost resolves to ::1 while
    // uvicorn binds IPv4 only, which surfaces as an opaque "http proxy error"
    // and can leave the request hanging rather than failing fast.
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
});
