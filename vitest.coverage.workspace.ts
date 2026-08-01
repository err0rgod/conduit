import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
      pool: 'forks',
      testTimeout: 15_000,
      hookTimeout: 15_000,
    },
  },
]);
