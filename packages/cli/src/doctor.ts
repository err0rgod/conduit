import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConfigStore } from '@conduit/config';
import { getAppDataDir } from '@conduit/security';
import { DaemonLifecycle } from './lifecycle';
import { resolveDistributionAsset, resolveDistributionEntry } from './runtime-paths';

export type DoctorCheckStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: DoctorCheckStatus;
  message: string;
}

export interface DoctorReport {
  healthy: boolean;
  checks: DoctorCheck[];
}

export async function runDoctor(
  configStore = new ConfigStore(),
  lifecycle = new DaemonLifecycle({ configStore }),
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: 'node',
    status: nodeMajor >= 22 ? 'pass' : 'fail',
    message: `Node ${process.versions.node}${nodeMajor >= 22 ? ' is supported.' : ' is unsupported; use Node 22 or newer.'}`,
  });
  checks.push({
    name: 'package-manager',
    status: process.env.npm_config_user_agent?.includes('pnpm') ? 'pass' : 'warn',
    message: process.env.npm_config_user_agent ?? 'Package-manager user agent is unavailable.',
  });

  let config: ReturnType<ConfigStore['load']> | undefined;
  try {
    config = configStore.load();
    checks.push({
      name: 'configuration',
      status: 'pass',
      message: `Valid version ${config.version} configuration at ${configStore.getPath()}.`,
    });
  } catch (error) {
    checks.push({
      name: 'configuration',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Configuration validation failed.',
    });
  }

  const storageDirectory = getAppDataDir();
  try {
    fs.mkdirSync(storageDirectory, { recursive: true, mode: 0o700 });
    fs.accessSync(storageDirectory, fs.constants.R_OK | fs.constants.W_OK);
    checks.push({
      name: 'storage',
      status: 'pass',
      message: `Application storage is readable and writable: ${storageDirectory}.`,
    });
  } catch (error) {
    checks.push({
      name: 'storage',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Application storage is not writable.',
    });
  }

  if (config) {
    if (config.remote.tlsKeyPath && !fs.existsSync(path.resolve(config.remote.tlsKeyPath))) {
      checks.push({ name: 'remote-tls-key', status: 'fail', message: 'TLS key file is missing.' });
    }
    if (
      config.remote.tlsCertificatePath &&
      !fs.existsSync(path.resolve(config.remote.tlsCertificatePath))
    ) {
      checks.push({
        name: 'remote-tls-certificate',
        status: 'fail',
        message: 'TLS certificate file is missing.',
      });
    }
    checks.push({
      name: 'remote-safety',
      status:
        config.daemon.bindAddress === '127.0.0.1' || config.daemon.bindAddress === '::1'
          ? 'pass'
          : 'warn',
      message:
        config.daemon.bindAddress === '127.0.0.1' || config.daemon.bindAddress === '::1'
          ? 'Daemon is loopback-only.'
          : `Daemon is configured to bind ${config.daemon.bindAddress}; verify TLS and network controls.`,
    });
  }

  try {
    const status = await lifecycle.status();
    checks.push({
      name: 'daemon',
      status: status.running ? 'pass' : 'warn',
      message: status.message,
    });
    checks.push({
      name: 'extension',
      status: status.health?.extensionConnected ? 'pass' : 'warn',
      message: status.health?.extensionConnected
        ? 'Browser extension is authenticated and connected.'
        : 'Browser extension is not connected.',
    });
  } catch (error) {
    checks.push({
      name: 'daemon',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Daemon diagnostics failed.',
    });
  }

  const { NativeHostInstaller } = require('./native-host');
  const nativeHostStatus = new NativeHostInstaller().status();
  checks.push({
    name: 'native-host',
    status: nativeHostStatus.installed ? 'pass' : 'warn',
    message: nativeHostStatus.installed
      ? 'Native messaging host is registered.'
      : 'Native messaging host is not registered; extension will not auto-connect.',
  });

  checks.push({
    name: 'extension-identity',
    status: 'pass',
    message: 'Expected extension identity is jkdlmcpkgkooilffjegfjmkanoelbmbl.',
  });

  const mcpPath =
    resolveDistributionEntry('mcp.cjs') ?? resolvePackageSibling('@conduit/mcp-server', 'main.js');
  checks.push({
    name: 'mcp',
    status: mcpPath && fs.existsSync(mcpPath) ? 'pass' : 'warn',
    message: mcpPath ? `MCP server build found at ${mcpPath}.` : 'MCP server build is missing.',
  });

  const docsPath = resolvePackage('@conduit/docs');
  checks.push({
    name: 'documentation',
    status: docsPath && fs.existsSync(docsPath) ? 'pass' : 'warn',
    message: docsPath ? `Documentation build found at ${docsPath}.` : 'Documentation is not built.',
  });

  return { healthy: checks.every((check) => check.status !== 'fail'), checks };
}

function resolvePackage(packageName: string): string | undefined {
  try {
    return require.resolve(packageName);
  } catch {
    return undefined;
  }
}

function resolvePackageSibling(packageName: string, filename: string): string | undefined {
  const entry = resolvePackage(packageName);
  return entry ? path.join(path.dirname(entry), filename) : undefined;
}
