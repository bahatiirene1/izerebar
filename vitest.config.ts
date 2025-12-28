import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Run tests sequentially within files to avoid database conflicts
    sequence: {
      concurrent: false,
    },
    // Run test files sequentially (not in parallel)
    fileParallelism: false,
  },
});
