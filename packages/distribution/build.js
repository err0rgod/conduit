const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const packageRoot = __dirname;
const repositoryRoot = path.resolve(packageRoot, '../..');
const outputRoot = path.join(packageRoot, 'package');
const outputDist = path.join(outputRoot, 'dist');
const extensionSource = path.join(repositoryRoot, 'apps/extension/dist');

async function bundle(entryPoint, outfile, executable = false) {
  await esbuild.build({
    entryPoints: [path.join(packageRoot, entryPoint)],
    outfile: path.join(outputDist, outfile),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    sourcemap: false,
    legalComments: 'eof',
    ...(executable ? { banner: { js: '#!/usr/bin/env node' } } : {}),
  });
}

async function main() {
  if (!fs.existsSync(path.join(extensionSource, 'manifest.json'))) {
    throw new Error('Extension build is missing. Run pnpm extension:build first.');
  }

  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputDist, { recursive: true });
  await bundle('src/cli.ts', 'cli.cjs', true);
  await bundle('src/daemon.ts', 'daemon.cjs');
  await bundle('src/mcp.ts', 'mcp.cjs');

  fs.cpSync(extensionSource, path.join(outputRoot, 'extension'), { recursive: true });
  fs.copyFileSync(path.join(repositoryRoot, 'README.md'), path.join(outputRoot, 'README.md'));
  fs.copyFileSync(path.join(repositoryRoot, 'LICENSE'), path.join(outputRoot, 'LICENSE'));
  fs.writeFileSync(
    path.join(outputRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'conduit-browser',
        version: '0.1.0',
        description: 'Open-source, local-first browser-control bridge for AI agents.',
        bin: { conduit: 'dist/cli.cjs' },
        files: ['dist', 'extension', 'README.md', 'LICENSE'],
        engines: { node: '>=22.0.0' },
        license: 'MIT',
        repository: { type: 'git', url: 'git+https://github.com/err0rgod/conduit.git' },
        bugs: { url: 'https://github.com/err0rgod/conduit/issues' },
        homepage: 'https://err0rgod.github.io/conduit/',
        keywords: ['ai-agents', 'browser-automation', 'chrome-extension', 'local-first', 'mcp'],
        publishConfig: { access: 'public' },
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Distribution build failed.'}\n`,
  );
  process.exitCode = 1;
});
