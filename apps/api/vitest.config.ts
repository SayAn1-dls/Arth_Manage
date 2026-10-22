import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false, // integration tests share one database
    env: { NODE_ENV: 'test' },
    setupFiles: ['./src/test/setup.ts'],
  },
});
