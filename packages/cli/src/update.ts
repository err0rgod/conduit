import { spawnSync } from 'node:child_process';

const PACKAGE_NAME = 'conduit-browser';

export interface UpdateReport {
  package: string;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  installed: boolean;
  message: string;
}

export interface UpdateManagerOptions {
  currentVersion?: string;
  fetch?: typeof globalThis.fetch;
  platform?: NodeJS.Platform;
  run?: (command: string, args: string[]) => void;
}

export class UpdateManager {
  private readonly currentVersion: string;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly platform: NodeJS.Platform;
  private readonly runCommand: (command: string, args: string[]) => void;

  public constructor(options: UpdateManagerOptions = {}) {
    this.currentVersion = options.currentVersion ?? '0.1.0';
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.platform = options.platform ?? process.platform;
    this.runCommand = options.run ?? runChecked;
  }

  public async check(): Promise<UpdateReport> {
    const latestVersion = await this.latestVersion();
    const updateAvailable = latestVersion !== this.currentVersion;
    return {
      package: PACKAGE_NAME,
      currentVersion: this.currentVersion,
      latestVersion,
      updateAvailable,
      installed: false,
      message: updateAvailable
        ? `Conduit ${latestVersion} is available.`
        : 'Conduit is already up to date.',
    };
  }

  public async upgrade(): Promise<UpdateReport> {
    const report = await this.check();
    if (!report.updateAvailable) return report;
    const specifier = `${PACKAGE_NAME}@${report.latestVersion}`;
    if (this.platform === 'win32') {
      this.runCommand(process.env.ComSpec ?? 'cmd.exe', [
        '/d',
        '/s',
        '/c',
        `npm install --global ${specifier}`,
      ]);
    } else {
      this.runCommand('npm', ['install', '--global', specifier]);
    }
    return {
      ...report,
      installed: true,
      message: `Conduit was upgraded to ${report.latestVersion}.`,
    };
  }

  private async latestVersion(): Promise<string> {
    const response = await this.fetchImplementation(
      `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
      {
        headers: { accept: 'application/json' },
      },
    );
    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? 'Conduit has not been published to npm yet. Install a GitHub release artifact instead.'
          : `npm registry request failed with HTTP ${response.status}.`,
      );
    }
    const value = (await response.json()) as { version?: unknown };
    if (
      typeof value.version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(value.version)
    ) {
      throw new Error('npm registry returned an invalid Conduit version.');
    }
    return value.version;
  }
}

function runChecked(command: string, args: string[]): void {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail =
      result.stderr.trim() || result.stdout.trim() || `exit code ${String(result.status)}`;
    throw new Error(`Conduit upgrade failed: ${detail}`);
  }
}
