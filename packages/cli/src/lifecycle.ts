import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { ConfigStore, ConduitConfig } from '@conduit/config';
import { ConduitClient, DaemonHealth } from '@conduit/daemon-client';
import { getAppDataDir, LocalAuth } from '@conduit/security';
import { resolveDistributionEntry } from './runtime-paths';

export interface DaemonState {
  version: 1;
  pid: number;
  instanceId: string;
  port: number;
  startedAt: number;
}

export interface LifecycleStatus {
  running: boolean;
  state?: DaemonState;
  health?: DaemonHealth;
  message: string;
}

export interface DaemonLifecycleOptions {
  configStore?: ConfigStore;
  statePath?: string;
  logPath?: string;
  daemonEntryPath?: string;
  startupTimeoutMs?: number;
  auth?: LocalAuth;
}

export class DaemonLifecycle {
  private readonly configStore: ConfigStore;
  private readonly statePath: string;
  private readonly logPath: string;
  private readonly daemonEntryPath: string;
  private readonly startupTimeoutMs: number;
  private readonly auth: LocalAuth;

  public constructor(options: DaemonLifecycleOptions = {}) {
    this.configStore = options.configStore ?? new ConfigStore();
    this.statePath = options.statePath ?? path.join(getAppDataDir(), 'daemon-state.json');
    this.logPath = options.logPath ?? path.join(getAppDataDir(), 'daemon.log');
    this.daemonEntryPath = options.daemonEntryPath ?? resolveDaemonEntry();
    this.startupTimeoutMs = options.startupTimeoutMs ?? 20_000;
    this.auth = options.auth ?? new LocalAuth();
  }

  public async start(): Promise<LifecycleStatus> {
    const existing = await this.status();
    if (existing.running) return { ...existing, message: 'Conduit daemon is already running.' };
    const config = this.configStore.load();
    if (!fs.existsSync(this.daemonEntryPath)) {
      throw new Error(`Daemon build not found: ${this.daemonEntryPath}. Run pnpm build first.`);
    }

    const instanceId = crypto.randomUUID();
    fs.mkdirSync(path.dirname(this.logPath), { recursive: true, mode: 0o700 });
    const logDescriptor = fs.openSync(this.logPath, 'a', 0o600);
    const child = spawn(process.execPath, [this.daemonEntryPath], {
      detached: true,
      windowsHide: true,
      stdio: ['ignore', logDescriptor, logDescriptor],
      env: {
        ...process.env,
        CONDUIT_CONFIG_PATH: this.configStore.getPath(),
        CONDUIT_INSTANCE_ID: instanceId,
      },
    });
    fs.closeSync(logDescriptor);
    if (!child.pid) throw new Error('Failed to obtain the daemon process ID.');
    child.unref();

    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      const health = await readHealth(config, this.auth);
      if (health?.instanceId === instanceId) {
        const state: DaemonState = {
          version: 1,
          pid: child.pid,
          instanceId,
          port: config.daemon.port,
          startedAt: Date.now(),
        };
        this.writeState(state);
        return { running: true, state, health, message: 'Conduit daemon started.' };
      }
      await delay(250);
    }

    try {
      process.kill(child.pid);
    } catch {
      // The failed child may already have exited; its log contains the startup reason.
    }
    throw new Error(`Daemon did not become healthy. Inspect ${this.logPath}.`);
  }

  public async stop(force = false): Promise<LifecycleStatus> {
    const state = this.readState();
    if (!state) return { running: false, message: 'Conduit daemon is not managed by this CLI.' };
    const config = this.configStore.load();
    const health = await readHealth(config, this.auth);
    if (health?.instanceId !== state.instanceId) {
      if (!force) {
        throw new Error(
          'Daemon identity could not be verified. Use --force only after checking the recorded PID.',
        );
      }
      process.kill(state.pid);
    } else {
      const client = createClient(config, this.auth);
      await client.shutdown();
      await waitForShutdown(config, this.auth, 10_000);
    }
    if (fs.existsSync(this.statePath)) fs.rmSync(this.statePath);
    return { running: false, message: 'Conduit daemon stopped.' };
  }

  public async restart(force = false): Promise<LifecycleStatus> {
    const current = await this.status();
    if (current.state) await this.stop(force);
    return this.start();
  }

  public async status(): Promise<LifecycleStatus> {
    const state = this.readState();
    const config = this.configStore.load();
    const health = await readHealth(config, this.auth);
    if (!health) {
      return { running: false, ...(state ? { state } : {}), message: 'Conduit daemon is offline.' };
    }
    if (state && health.instanceId !== state.instanceId) {
      return {
        running: false,
        state,
        health,
        message: 'A daemon is reachable, but it does not match the managed instance.',
      };
    }
    return {
      running: true,
      ...(state ? { state } : {}),
      health,
      message: state ? 'Conduit daemon is running.' : 'An unmanaged Conduit daemon is running.',
    };
  }

  public readLogs(lines = 100): string[] {
    if (!fs.existsSync(this.logPath)) return [];
    return fs
      .readFileSync(this.logPath, 'utf8')
      .split(/\r?\n/u)
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(lines, 10_000)));
  }

  public getLogPath(): string {
    return this.logPath;
  }

  public getStatePath(): string {
    return this.statePath;
  }

  private readState(): DaemonState | undefined {
    if (!fs.existsSync(this.statePath)) return undefined;
    try {
      const value = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as Partial<DaemonState>;
      if (
        value.version === 1 &&
        typeof value.pid === 'number' &&
        Number.isInteger(value.pid) &&
        typeof value.instanceId === 'string' &&
        typeof value.port === 'number' &&
        typeof value.startedAt === 'number'
      ) {
        return value as DaemonState;
      }
    } catch {
      // Invalid state is treated as untrusted and never used to signal a process.
    }
    return undefined;
  }

  private writeState(state: DaemonState): void {
    const directory = path.dirname(this.statePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    try {
      fs.chmodSync(directory, 0o700);
      fs.chmodSync(this.statePath, 0o600);
    } catch {
      // Windows uses profile ACLs rather than POSIX permission bits.
    }
  }
}

export function daemonBaseUrl(config: ConduitConfig): string {
  const protocol = config.remote.tlsKeyPath && config.remote.tlsCertificatePath ? 'https' : 'http';
  const configuredHost = config.daemon.bindAddress;
  const host =
    configuredHost === '0.0.0.0'
      ? '127.0.0.1'
      : configuredHost === '::'
        ? '[::1]'
        : configuredHost.includes(':') && !configuredHost.startsWith('[')
          ? `[${configuredHost}]`
          : configuredHost;
  return `${protocol}://${host}:${config.daemon.port}`;
}

function resolveDaemonEntry(): string {
  const distributionEntry = resolveDistributionEntry('daemon.cjs');
  if (distributionEntry) return distributionEntry;
  try {
    return path.join(path.dirname(require.resolve('@conduit/daemon')), 'main.js');
  } catch {
    return path.resolve('apps/daemon/dist/main.js');
  }
}

function createClient(config: ConduitConfig, auth: LocalAuth): ConduitClient {
  return new ConduitClient({ baseUrl: daemonBaseUrl(config), auth });
}

async function readHealth(
  config: ConduitConfig,
  auth: LocalAuth,
): Promise<DaemonHealth | undefined> {
  try {
    return await createClient(config, auth).health();
  } catch {
    return undefined;
  }
}

async function waitForShutdown(
  config: ConduitConfig,
  auth: LocalAuth,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await readHealth(config, auth))) return;
    await delay(100);
  }
  throw new Error('Daemon did not shut down before timeout.');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
