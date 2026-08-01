const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const packageRoot = __dirname;
const outputRoot = path.join(packageRoot, 'package');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-install-'));
const packRoot = path.join(testRoot, 'pack');
const installRoot = path.join(testRoot, 'install');
const dataRoot = path.join(testRoot, 'data');
const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
const npmArgs =
  process.platform === 'win32'
    ? [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')]
    : [];
let cliPath;
let daemonStarted = false;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: { ...process.env, CONDUIT_DATA_DIR: dataRoot },
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(' ')}\n${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    );
  }
  return result.stdout;
}

try {
  fs.mkdirSync(packRoot, { recursive: true });
  run(npmCommand, [...npmArgs, 'pack', outputRoot, '--pack-destination', packRoot]);
  const tarball = fs
    .readdirSync(packRoot)
    .filter((file) => file.endsWith('.tgz'))
    .map((file) => path.join(packRoot, file))[0];
  if (!tarball) throw new Error('npm pack did not produce a tarball.');

  run(npmCommand, [
    ...npmArgs,
    'install',
    '--prefix',
    installRoot,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    tarball,
  ]);
  const installedRoot = path.join(installRoot, 'node_modules', 'conduit-browser');
  cliPath = path.join(installedRoot, 'dist', 'cli.cjs');
  run(npmCommand, [...npmArgs, 'exec', '--prefix', installRoot, '--', 'conduit', '--help']);
  run(process.execPath, [cliPath, '--help']);

  const extensionOutput = JSON.parse(
    run(process.execPath, [cliPath, '--json', 'extension', 'path']),
  );
  if (!fs.existsSync(path.join(extensionOutput.path, 'manifest.json'))) {
    throw new Error('Installed extension manifest was not found.');
  }

  const setup = JSON.parse(
    run(process.execPath, [cliPath, '--json', 'setup', '--no-service', '--no-start']),
  );
  if (!setup.configured || !fs.existsSync(setup.configPath)) {
    throw new Error('Installed setup command did not initialize Conduit configuration.');
  }

  run(process.execPath, [cliPath, '--json', 'start']);
  daemonStarted = true;
  const status = JSON.parse(run(process.execPath, [cliPath, '--json', 'status']));
  if (!status.running) throw new Error('Installed daemon did not report a running state.');
  run(process.execPath, [cliPath, '--json', 'stop']);
  daemonStarted = false;
  process.stdout.write(
    'Clean tarball install, setup, extension discovery, and daemon lifecycle passed.\n',
  );
} finally {
  if (daemonStarted && cliPath) {
    spawnSync(process.execPath, [cliPath, '--json', 'stop', '--force'], {
      encoding: 'utf8',
      env: { ...process.env, CONDUIT_DATA_DIR: dataRoot },
    });
  }
  fs.rmSync(testRoot, { recursive: true, force: true });
}
