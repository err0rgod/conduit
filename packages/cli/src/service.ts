import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getAppDataDir } from '@conduit/security';

export type ServicePlatform = 'win32' | 'darwin' | 'linux';

export interface ServiceResult {
  platform: ServicePlatform;
  installed: boolean;
  running?: boolean;
  definitionPath?: string;
  message: string;
}

export interface ServiceCommand {
  command: string;
  args: string[];
}

export interface UserServiceOptions {
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  cliEntryPath?: string;
  nodePath?: string;
  run?: (command: ServiceCommand) => void;
}

const WINDOWS_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const WINDOWS_VALUE_NAME = 'Conduit';
const MACOS_LABEL = 'dev.conduit.browser-bridge';
const LINUX_UNIT = 'conduit.service';

export class UserService {
  private readonly platform: ServicePlatform;
  private readonly homeDirectory: string;
  private readonly cliEntryPath: string;
  private readonly nodePath: string;
  private readonly runCommand: (command: ServiceCommand) => void;

  public constructor(options: UserServiceOptions = {}) {
    this.platform = supportedPlatform(options.platform ?? process.platform);
    this.homeDirectory = options.homeDirectory ?? os.homedir();
    this.cliEntryPath = options.cliEntryPath ?? path.resolve(process.argv[1] ?? __filename);
    this.nodePath = options.nodePath ?? path.resolve(process.execPath);
    this.runCommand = options.run ?? runChecked;
  }

  public install(): ServiceResult {
    if (this.platform === 'win32') {
      this.runCommand({
        command: 'reg.exe',
        args: [
          'ADD',
          WINDOWS_RUN_KEY,
          '/v',
          WINDOWS_VALUE_NAME,
          '/t',
          'REG_SZ',
          '/d',
          windowsRunAction(this.nodePath, this.cliEntryPath),
          '/f',
        ],
      });
      return this.result(true, 'Conduit will start when this Windows user signs in.');
    }

    const definitionPath = this.definitionPath();
    fs.mkdirSync(path.dirname(definitionPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(definitionPath, this.definition(), { mode: 0o600 });

    if (this.platform === 'darwin') {
      this.runAllowingFailure({
        command: 'launchctl',
        args: ['bootout', guiDomain(), definitionPath],
      });
      this.runCommand({ command: 'launchctl', args: ['bootstrap', guiDomain(), definitionPath] });
    } else {
      this.runCommand({ command: 'systemctl', args: ['--user', 'daemon-reload'] });
      this.runCommand({ command: 'systemctl', args: ['--user', 'enable', LINUX_UNIT] });
    }
    return this.result(true, 'Conduit is installed as a user-level login service.', definitionPath);
  }

  public start(): ServiceResult {
    if (this.platform === 'win32') {
      this.runCommand({ command: this.nodePath, args: [this.cliEntryPath, 'start'] });
    } else if (this.platform === 'darwin') {
      this.runCommand({
        command: 'launchctl',
        args: ['kickstart', '-k', `${guiDomain()}/${MACOS_LABEL}`],
      });
    } else {
      this.runCommand({ command: 'systemctl', args: ['--user', 'start', LINUX_UNIT] });
    }
    return this.result(
      this.isInstalled(),
      'Conduit user service start requested.',
      this.optionalDefinitionPath(),
    );
  }

  public stop(): ServiceResult {
    if (this.platform === 'win32') {
      this.runAllowingFailure({
        command: this.nodePath,
        args: [this.cliEntryPath, 'stop'],
      });
    } else if (this.platform === 'darwin') {
      this.runAllowingFailure({
        command: 'launchctl',
        args: ['kill', 'SIGTERM', `${guiDomain()}/${MACOS_LABEL}`],
      });
    } else {
      this.runAllowingFailure({ command: 'systemctl', args: ['--user', 'stop', LINUX_UNIT] });
    }
    return this.result(
      this.isInstalled(),
      'Conduit user service stop requested.',
      this.optionalDefinitionPath(),
    );
  }

  public uninstall(): ServiceResult {
    if (this.platform === 'win32') {
      this.runAllowingFailure({
        command: 'reg.exe',
        args: ['DELETE', WINDOWS_RUN_KEY, '/v', WINDOWS_VALUE_NAME, '/f'],
      });
    } else if (this.platform === 'darwin') {
      const definitionPath = this.definitionPath();
      this.runAllowingFailure({
        command: 'launchctl',
        args: ['bootout', guiDomain(), definitionPath],
      });
      if (fs.existsSync(definitionPath)) fs.rmSync(definitionPath);
    } else {
      this.runAllowingFailure({
        command: 'systemctl',
        args: ['--user', 'disable', '--now', LINUX_UNIT],
      });
      const definitionPath = this.definitionPath();
      if (fs.existsSync(definitionPath)) fs.rmSync(definitionPath);
      this.runCommand({ command: 'systemctl', args: ['--user', 'daemon-reload'] });
    }
    return this.result(false, 'Conduit user service was removed.', this.optionalDefinitionPath());
  }

  public status(): ServiceResult {
    const installed = this.isInstalled();
    return this.result(
      installed,
      installed ? 'Conduit user service is installed.' : 'Conduit user service is not installed.',
      this.optionalDefinitionPath(),
    );
  }

  public isInstalled(): boolean {
    if (this.platform === 'win32') {
      const result = spawnSync('reg.exe', ['QUERY', WINDOWS_RUN_KEY, '/v', WINDOWS_VALUE_NAME], {
        windowsHide: true,
        stdio: 'ignore',
      });
      return result.status === 0;
    }
    return fs.existsSync(this.definitionPath());
  }

  public definitionPath(): string {
    if (this.platform === 'win32')
      throw new Error('Windows stores automatic startup in the current-user Run registry key.');
    return this.platform === 'darwin'
      ? path.join(this.homeDirectory, 'Library', 'LaunchAgents', `${MACOS_LABEL}.plist`)
      : path.join(this.homeDirectory, '.config', 'systemd', 'user', LINUX_UNIT);
  }

  public definition(): string {
    if (this.platform === 'win32')
      throw new Error('Windows stores automatic startup in the current-user Run registry key.');
    if (this.platform === 'darwin') {
      return `${['<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">', '<plist version="1.0"><dict>', `<key>Label</key><string>${MACOS_LABEL}</string>`, '<key>ProgramArguments</key><array>', `<string>${escapeXml(this.nodePath)}</string>`, `<string>${escapeXml(this.cliEntryPath)}</string>`, '<string>start</string>', '</array>', '<key>RunAtLoad</key><true/>', '<key>ProcessType</key><string>Background</string>', `<key>StandardOutPath</key><string>${escapeXml(path.join(getAppDataDir(), 'service.log'))}</string>`, `<key>StandardErrorPath</key><string>${escapeXml(path.join(getAppDataDir(), 'service.log'))}</string>`, '</dict></plist>'].join('\n')}\n`;
    }
    return `${['[Unit]', 'Description=Conduit local-first browser bridge', 'After=network.target', '', '[Service]', 'Type=oneshot', `ExecStart=${systemdArgument(this.nodePath)} ${systemdArgument(this.cliEntryPath)} start`, `ExecStop=${systemdArgument(this.nodePath)} ${systemdArgument(this.cliEntryPath)} stop`, 'RemainAfterExit=yes', '', '[Install]', 'WantedBy=default.target'].join('\n')}\n`;
  }

  private optionalDefinitionPath(): string | undefined {
    return this.platform === 'win32' ? undefined : this.definitionPath();
  }

  private result(installed: boolean, message: string, definitionPath?: string): ServiceResult {
    return {
      platform: this.platform,
      installed,
      ...(definitionPath ? { definitionPath } : {}),
      message,
    };
  }

  private runAllowingFailure(command: ServiceCommand): void {
    try {
      this.runCommand(command);
    } catch {
      // Stop/unload is idempotent when the service is already inactive.
    }
  }
}

function supportedPlatform(platform: NodeJS.Platform): ServicePlatform {
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') return platform;
  throw new Error(`User service installation is not supported on ${platform}.`);
}

function runChecked({ command, args }: ServiceCommand): void {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail =
      result.stderr.trim() || result.stdout.trim() || `exit code ${String(result.status)}`;
    throw new Error(`${command} failed: ${detail}`);
  }
}

function windowsRunAction(nodePath: string, cliEntryPath: string): string {
  return `\"${nodePath.replaceAll('"', '\\"')}\" \"${cliEntryPath.replaceAll('"', '\\"')}\" start`;
}

function systemdArgument(value: string): string {
  return `\"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}\"`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function guiDomain(): string {
  return `gui/${typeof process.getuid === 'function' ? process.getuid() : os.userInfo().uid}`;
}
