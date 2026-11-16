import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss()],
  publicDir: 'public',
  build: { outDir: 'dist', assetsDir: 'ui', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:8765', '/assets': 'http://127.0.0.1:8765', '/uploads': 'http://127.0.0.1:8765' } },
  test: { environment: 'jsdom', include: ['src/**/*.test.{js,jsx}'] },
});
