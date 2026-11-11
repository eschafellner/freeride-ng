import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { host: 'localhost', port: 5173 },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        debug: resolve(import.meta.dirname, 'debug.html'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
