const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function findDocsWorkspace(
  repositoryRoot = path.resolve(__dirname, '..'),
  environment = process.env,
) {
  const candidates = [
    environment.CONDUIT_DOCS_PATH,
    path.join(repositoryRoot, 'conduit-web'),
    path.resolve(repositoryRoot, '..', 'conduit-web'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const workspace = path.resolve(candidate);
    const packagePath = path.join(workspace, 'package.json');
    if (!fs.existsSync(packagePath)) continue;
    try {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      if (packageJson.name === 'conduit-web') return workspace;
    } catch {
      // Keep searching so a malformed unrelated package cannot be selected.
    }
  }
  return undefined;
}

function runDocs(command) {
  if (command !== 'build' && command !== 'dev') {
    throw new Error('Expected docs command "build" or "dev".');
  }
  const workspace = findDocsWorkspace();
  if (!workspace) {
    throw new Error(
      'Conduit documentation is maintained in https://github.com/err0rgod/conduit-web. ' +
        'Clone it beside this repository or set CONDUIT_DOCS_PATH.',
    );
  }
  const invocation = docsCommand(command);
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: workspace,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

function docsCommand(command, platform = process.platform, environment = process.env) {
  if (platform === 'win32') {
    return {
      executable: environment.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', `pnpm run ${command}`],
    };
  }
  return { executable: 'pnpm', args: ['run', command] };
}

if (require.main === module) {
  try {
    runDocs(process.argv[2]);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Documentation command failed.'}\n`,
    );
    process.exitCode = 1;
  }
}

module.exports = { docsCommand, findDocsWorkspace };
