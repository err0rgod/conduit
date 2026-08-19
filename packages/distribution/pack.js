const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const packageRoot = __dirname;
const outputRoot = path.join(packageRoot, 'package');
const artifacts = path.resolve(packageRoot, '../../artifacts');
if (!fs.existsSync(path.join(outputRoot, 'package.json'))) {
  throw new Error('Distribution build is missing. Run pnpm distribution:build first.');
}
fs.mkdirSync(artifacts, { recursive: true });
const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
const npmArgs =
  process.platform === 'win32'
    ? [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')]
    : [];
const npmEnvironment = { ...process.env };
delete npmEnvironment.npm_config_recursive;
delete npmEnvironment.NPM_CONFIG_RECURSIVE;
const result = spawnSync(
  npmCommand,
  [...npmArgs, 'pack', outputRoot, '--pack-destination', artifacts],
  {
    stdio: 'inherit',
    env: npmEnvironment,
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
