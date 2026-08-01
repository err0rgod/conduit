import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      include: ['packages/*/test/**/*.test.ts'],
      exclude: [
        'packages/cli/test/lifecycle.test.ts',
        'packages/mcp-server/test/**/*.integration.test.ts',
      ],
      pool: 'forks',
    },
  },
]);
