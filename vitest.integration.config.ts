import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      include: [
        'apps/*/test/**/*.test.ts',
        'packages/cli/test/lifecycle.test.ts',
        'packages/mcp-server/test/**/*.integration.test.ts',
        'tests/integration/**/*.test.ts',
      ],
      pool: 'forks',
      testTimeout: 15_000,
      hookTimeout: 15_000,
    },
  },
]);
