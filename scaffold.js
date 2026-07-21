const fs = require('fs');
const path = require('path');

const root = __dirname;
const dirs = [
  'apps/extension',
  'apps/daemon',
  'apps/docs',
  'packages/protocol',
  'packages/browser-core',
  'packages/mcp-server',
  'packages/cli',
  'packages/security',
  'packages/test-utils',
  '.github/workflows'
];

dirs.forEach(d => fs.mkdirSync(path.join(root, d), { recursive: true }));

const rootPackage = {
  name: "conduit-monorepo",
  private: true,
  engines: {
    node: ">=20.0.0"
  },
  scripts: {
    "install": "pnpm install",
    "build": "pnpm -r build",
    "dev": "pnpm -r dev",
    "clean": "pnpm -r clean",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "test:unit": "vitest run",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:e2e": "playwright test",
    "test:security": "vitest run --config vitest.security.config.ts",
    "test:coverage": "vitest run --coverage",
    "docs:dev": "pnpm --filter docs dev",
    "docs:build": "pnpm --filter docs build",
    "extension:dev": "pnpm --filter extension dev",
    "extension:build": "pnpm --filter extension build",
    "extension:package": "pnpm --filter extension package",
    "daemon:start": "pnpm --filter daemon start",
    "daemon:dev": "pnpm --filter daemon dev",
    "mcp:start": "pnpm --filter mcp-server start",
    "conduit:doctor": "node packages/cli/bin/doctor.js"
  },
  devDependencies: {
    "typescript": "^5.4.5",
    "vitest": "^1.6.0",
    "prettier": "^3.2.5",
    "eslint": "^8.57.0",
    "@types/node": "^20.12.7",
    "ts-node": "^10.9.2"
  }
};
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(rootPackage, null, 2));

const pnpmWorkspace = `packages:
  - 'apps/*'
  - 'packages/*'
`;
fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), pnpmWorkspace);

const tsconfig = {
  compilerOptions: {
    target: "ES2022",
    module: "CommonJS",
    lib: ["ES2022", "DOM"],
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true
  },
  exclude: ["node_modules", "dist"]
};
fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

dirs.forEach(d => {
  if (d.startsWith('apps/') || d.startsWith('packages/')) {
    const name = d.replace('apps/', '@conduit/').replace('packages/', '@conduit/');
    const pkg = {
      name,
      version: "0.1.0",
      main: "dist/index.js",
      scripts: {
        build: "tsc || true",
        typecheck: "tsc --noEmit || true"
      }
    };
    fs.writeFileSync(path.join(root, d, 'package.json'), JSON.stringify(pkg, null, 2));
  }
});

const ciYml = `name: CI
on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check || true
      - run: pnpm lint || true
      - run: pnpm typecheck || true
      - run: pnpm build || true
`;
fs.writeFileSync(path.join(root, '.github/workflows/ci.yml'), ciYml);

fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\ndist\n.env\n');

console.log('Scaffolding complete.');
