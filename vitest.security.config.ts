import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      include: ['packages/security/test/**/*.test.ts', 'tests/security/**/*.test.ts'],
      pool: 'forks',
      testTimeout: 15_000,
    },
  },
]);
