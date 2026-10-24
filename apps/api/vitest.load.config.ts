import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  test: {
    environment: 'node',
    include: ['src/**/*.load.ts'],
    fileParallelism: false,
    env: { NODE_ENV: 'test' },
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
