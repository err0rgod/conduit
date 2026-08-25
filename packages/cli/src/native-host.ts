import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CHROME_WEB_STORE_EXTENSION_ID, ConfigStore } from '@conduit/config';
import { LocalAuth } from '@conduit/security';
import { resolveDistributionEntry } from './runtime-paths';

export const EXPECTED_EXTENSION_ORIGIN = 'chrome-extension://jkdlmcpkgkooilffjegfjmkanoelbmbl/';
export const CHROME_WEB_STORE_EXTENSION_ORIGIN = `chrome-extension://${CHROME_WEB_STORE_EXTENSION_ID}/`;
export const EXPECTED_FIREFOX_EXTENSION_ID = 'conduit@err0rgod.github.io';
export const NATIVE_HOST_NAME = 'io.github.err0rgod.conduit';
export const NATIVE_PROTOCOL_VERSION = 1;
export const MAX_NATIVE_REQUEST_BYTES = 64 * 1024;

interface NativeConnectionRequest {
  type: 'conduit.get-connection-settings';
  protocolVersion: typeof NATIVE_PROTOCOL_VERSION;
}

interface NativeConnectionResponse {
  type: 'conduit.connection-settings';
  protocolVersion: typeof NATIVE_PROTOCOL_VERSION;
  daemonPort: number;
  daemonToken: string;
}

export interface NativeHostRuntimeOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  configStore?: Pick<ConfigStore, 'load'>;
  auth?: Pick<LocalAuth, 'ensureToken'>;
}

export async function runNativeHost(
  caller: string,
  options: NativeHostRuntimeOptions = {},
): Promise<void> {
  const config = (options.configStore ?? new ConfigStore()).load();
  if (!isTrustedNativeCaller(caller, config.browser)) {
    throw new Error('Native messaging request came from an unauthorized browser extension.');
  }

  parseNativeRequest(await readNativeMessage(options.input ?? process.stdin));
  const token = (options.auth ?? new LocalAuth()).ensureToken();
  const response: NativeConnectionResponse = {
    type: 'conduit.connection-settings',
    protocolVersion: NATIVE_PROTOCOL_VERSION,
    daemonPort: config.daemon.port,
    daemonToken: token,
  };
  await writeNativeMessage(options.output ?? process.stdout, response);
}

export function parseNativeRequest(value: unknown): NativeConnectionRequest {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('type' in value) ||
    value.type !== 'conduit.get-connection-settings' ||
    !('protocolVersion' in value) ||
    value.protocolVersion !== NATIVE_PROTOCOL_VERSION ||
    Object.keys(value).some((key) => !['type', 'protocolVersion'].includes(key))
  ) {
    throw new Error('Native messaging request is invalid or uses an unsupported protocol version.');
  }
  return value as NativeConnectionRequest;
}

export async function readNativeMessage(input: NodeJS.ReadableStream): Promise<unknown> {
  let buffer = Buffer.alloc(0);
  let expectedLength: number | undefined;

  for await (const rawChunk of input as AsyncIterable<Buffer | string>) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    buffer = Buffer.concat([buffer, chunk]);
    if (expectedLength === undefined && buffer.length >= 4) {
      expectedLength = buffer.readUInt32LE(0);
      if (expectedLength === 0) throw new Error('Native messaging payload is empty.');
      if (expectedLength > MAX_NATIVE_REQUEST_BYTES) {
        throw new Error('Native messaging payload exceeds the configured limit.');
      }
    }
    if (expectedLength !== undefined && buffer.length >= expectedLength + 4) {
      if (buffer.length !== expectedLength + 4) {
        throw new Error('Native messaging frame contains unexpected trailing bytes.');
      }
      const payload = buffer.subarray(4).toString('utf8');
      try {
        return JSON.parse(payload) as unknown;
      } catch {
        throw new Error('Native messaging payload is not valid JSON.');
      }
    }
  }

  throw new Error('Native messaging frame ended before the declared payload was received.');
}

export function encodeNativeMessage(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  if (payload.length > 1024 * 1024) {
    throw new Error("Native messaging response exceeds the browser's one-megabyte limit.");
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export async function writeNativeMessage(
  output: NodeJS.WritableStream,
  value: unknown,
): Promise<void> {
  const frame = encodeNativeMessage(value);
  await new Promise<void>((resolve, reject) => {
    output.write(frame, (error?: Error | null) => (error ? reject(error) : resolve()));
  });
}

export type NativeHostPlatform = 'win32' | 'darwin' | 'linux';

export interface NativeHostStatus {
  installed: boolean;
  manifestPaths?: string[];
  message?: string;
}

export interface NativeHostCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface NativeHostInstallerOptions {
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  cliEntryPath?: string;
  nodePath?: string;
  run?: (command: string, args: string[]) => NativeHostCommandResult;
  configStore?: Pick<ConfigStore, 'load'>;
}

export interface PlatformPaths {
  manifestDirectory: string;
  manifestPaths: string[];
  chromiumManifestPaths: string[];
  firefoxManifestPaths: string[];
  wrapperPath: string;
}

const WINDOWS_CHROMIUM_REGISTRY_KEYS = [
  `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
];
const WINDOWS_FIREFOX_REGISTRY_KEY = `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;

export class NativeHostInstaller {
  private readonly platform: NativeHostPlatform;
  private readonly homeDirectory: string;
  private readonly cliEntryPath: string;
  private readonly nodePath: string;
  private readonly runCommand: (command: string, args: string[]) => NativeHostCommandResult;
  private readonly configStore: Pick<ConfigStore, 'load'>;

  public constructor(options: NativeHostInstallerOptions = {}) {
    this.platform = supportedPlatform(options.platform ?? process.platform);
    this.homeDirectory = path.resolve(options.homeDirectory ?? os.homedir());
    this.cliEntryPath = resolveTargetPath(options.cliEntryPath ?? resolveCliEntry(), this.platform);
    this.nodePath = resolveTargetPath(options.nodePath ?? process.execPath, this.platform);
    this.runCommand = options.run ?? runCommand;
    this.configStore = options.configStore ?? new ConfigStore();
  }

  public install(): NativeHostStatus {
    const paths = this.platformPaths();
    try {
      this.writeWrapper(paths.wrapperPath);
      const chromiumManifest = this.chromiumManifest(paths.wrapperPath);
      const firefoxManifest = this.firefoxManifest(paths.wrapperPath);
      for (const manifestPath of paths.chromiumManifestPaths) {
        fs.mkdirSync(path.dirname(manifestPath), { recursive: true, mode: 0o700 });
        fs.writeFileSync(manifestPath, `${JSON.stringify(chromiumManifest, null, 2)}\n`, {
          mode: 0o600,
        });
      }
      for (const manifestPath of paths.firefoxManifestPaths) {
        fs.mkdirSync(path.dirname(manifestPath), { recursive: true, mode: 0o700 });
        fs.writeFileSync(manifestPath, `${JSON.stringify(firefoxManifest, null, 2)}\n`, {
          mode: 0o600,
        });
      }
      this.registerWindows(paths);
      const status = this.status();
      if (!status.installed) throw new Error(status.message ?? 'Native host verification failed.');
      return status;
    } catch (error) {
      this.removeFiles(paths);
      this.unregisterWindows(true);
      return {
        installed: false,
        message: error instanceof Error ? error.message : 'Native host installation failed.',
      };
    }
  }

  public uninstall(): NativeHostStatus {
    const paths = this.platformPaths();
    try {
      this.unregisterWindows(false);
      this.removeFiles(paths);
      const status = this.status();
      return status.installed
        ? { installed: true, message: 'Native messaging host removal could not be verified.' }
        : { installed: false, manifestPaths: paths.manifestPaths };
    } catch (error) {
      return {
        installed: true,
        message: error instanceof Error ? error.message : 'Native host removal failed.',
      };
    }
  }

  public status(): NativeHostStatus {
    const paths = this.platformPaths();
    if (!fs.existsSync(paths.wrapperPath)) {
      return { installed: false, message: 'Native host launcher is missing.' };
    }
    for (const [manifestPath, expectedManifest] of [
      ...paths.chromiumManifestPaths.map(
        (manifestPath) => [manifestPath, this.chromiumManifest(paths.wrapperPath)] as const,
      ),
      ...paths.firefoxManifestPaths.map(
        (manifestPath) => [manifestPath, this.firefoxManifest(paths.wrapperPath)] as const,
      ),
    ]) {
      if (!manifestMatches(manifestPath, expectedManifest)) {
        return {
          installed: false,
          message: `Native host manifest is missing or invalid: ${manifestPath}`,
        };
      }
    }
    if (this.platform === 'win32') {
      const registrations = [
        ...WINDOWS_CHROMIUM_REGISTRY_KEYS.map(
          (key) => [key, paths.chromiumManifestPaths[0]] as const,
        ),
        [WINDOWS_FIREFOX_REGISTRY_KEY, paths.firefoxManifestPaths[0]] as const,
      ];
      for (const [key, manifestPath] of registrations) {
        const result = this.runCommand('reg.exe', ['QUERY', key, '/ve']);
        if (result.error || result.status !== 0 || !result.stdout.includes(manifestPath)) {
          return {
            installed: false,
            message: `Native host registry entry is missing or invalid: ${key}`,
          };
        }
      }
    }
    return { installed: true, manifestPaths: paths.manifestPaths };
  }

  public platformPaths(): PlatformPaths {
    const filename = `${NATIVE_HOST_NAME}.json`;
    if (this.platform === 'win32') {
      const manifestDirectory = path.join(
        this.homeDirectory,
        'AppData',
        'Local',
        'Conduit',
        'NativeHost',
      );
      const chromiumManifestPath = path.join(
        manifestDirectory,
        `${NATIVE_HOST_NAME}.chromium.json`,
      );
      const firefoxManifestPath = path.join(manifestDirectory, `${NATIVE_HOST_NAME}.firefox.json`);
      return {
        manifestDirectory,
        manifestPaths: [chromiumManifestPath, firefoxManifestPath],
        chromiumManifestPaths: [chromiumManifestPath],
        firefoxManifestPaths: [firefoxManifestPath],
        wrapperPath: path.join(manifestDirectory, 'conduit-native-host.cmd'),
      };
    }

    const manifestDirectory =
      this.platform === 'darwin'
        ? path.join(this.homeDirectory, 'Library', 'Application Support', 'Conduit', 'NativeHost')
        : path.join(this.homeDirectory, '.config', 'conduit', 'native-host');
    const chromiumDirectories =
      this.platform === 'darwin'
        ? [
            ['Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'],
            [
              'Library',
              'Application Support',
              'Google',
              'ChromeForTesting',
              'NativeMessagingHosts',
            ],
            ['Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts'],
            [
              'Library',
              'Application Support',
              'BraveSoftware',
              'Brave-Browser',
              'NativeMessagingHosts',
            ],
            ['Library', 'Application Support', 'Chromium', 'NativeMessagingHosts'],
          ]
        : [
            ['.config', 'google-chrome', 'NativeMessagingHosts'],
            ['.config', 'google-chrome-for-testing', 'NativeMessagingHosts'],
            ['.config', 'microsoft-edge', 'NativeMessagingHosts'],
            ['.config', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'],
            ['.config', 'chromium', 'NativeMessagingHosts'],
          ];
    const firefoxDirectory =
      this.platform === 'darwin'
        ? ['Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts']
        : ['.mozilla', 'native-messaging-hosts'];
    const chromiumManifestPaths = chromiumDirectories.map((segments) =>
      path.join(this.homeDirectory, ...segments, filename),
    );
    const firefoxManifestPaths = [path.join(this.homeDirectory, ...firefoxDirectory, filename)];
    return {
      manifestDirectory,
      manifestPaths: [...chromiumManifestPaths, ...firefoxManifestPaths],
      chromiumManifestPaths,
      firefoxManifestPaths,
      wrapperPath: path.join(manifestDirectory, 'conduit-native-host.sh'),
    };
  }

  private chromiumManifest(wrapperPath: string): Record<string, unknown> {
    const extensionIds = this.configStore.load().browser.chromiumExtensionIds;
    return {
      name: NATIVE_HOST_NAME,
      description: 'Conduit local browser bridge',
      path: wrapperPath,
      type: 'stdio',
      allowed_origins: extensionIds.map((id) => chromiumExtensionOrigin(id)),
    };
  }

  private firefoxManifest(wrapperPath: string): Record<string, unknown> {
    return {
      name: NATIVE_HOST_NAME,
      description: 'Conduit local browser bridge',
      path: wrapperPath,
      type: 'stdio',
      allowed_extensions: this.configStore.load().browser.firefoxExtensionIds,
    };
  }

  private writeWrapper(wrapperPath: string): void {
    fs.mkdirSync(path.dirname(wrapperPath), { recursive: true, mode: 0o700 });
    if (this.platform === 'win32') {
      const nodePath = batchQuoted(this.nodePath);
      const cliPath = batchQuoted(this.cliEntryPath);
      fs.writeFileSync(
        wrapperPath,
        `@echo off\r\n${nodePath} ${cliPath} extension native-host %*\r\n`,
        { mode: 0o700 },
      );
      return;
    }
    fs.writeFileSync(
      wrapperPath,
      `#!/bin/sh\nexec ${shellQuoted(this.nodePath)} ${shellQuoted(this.cliEntryPath)} extension native-host "$@"\n`,
      { mode: 0o700 },
    );
  }

  private registerWindows(paths: PlatformPaths): void {
    if (this.platform !== 'win32') return;
    for (const key of WINDOWS_CHROMIUM_REGISTRY_KEYS) {
      this.runChecked('reg.exe', [
        'ADD',
        key,
        '/ve',
        '/t',
        'REG_SZ',
        '/d',
        paths.chromiumManifestPaths[0],
        '/f',
      ]);
    }
    this.runChecked('reg.exe', [
      'ADD',
      WINDOWS_FIREFOX_REGISTRY_KEY,
      '/ve',
      '/t',
      'REG_SZ',
      '/d',
      paths.firefoxManifestPaths[0],
      '/f',
    ]);
  }

  private unregisterWindows(allowFailure: boolean): void {
    if (this.platform !== 'win32') return;
    for (const key of [...WINDOWS_CHROMIUM_REGISTRY_KEYS, WINDOWS_FIREFOX_REGISTRY_KEY]) {
      const result = this.runCommand('reg.exe', ['DELETE', key, '/f']);
      if (!allowFailure && result.error) throw result.error;
      if (!allowFailure && result.status !== 0 && result.status !== 1) {
        throw commandError('reg.exe', result);
      }
    }
  }

  private runChecked(command: string, args: string[]): void {
    const result = this.runCommand(command, args);
    if (result.error) throw result.error;
    if (result.status !== 0) throw commandError(command, result);
  }

  private removeFiles(paths: PlatformPaths): void {
    for (const manifestPath of paths.manifestPaths) {
      if (fs.existsSync(manifestPath)) fs.rmSync(manifestPath);
    }
    if (fs.existsSync(paths.wrapperPath)) fs.rmSync(paths.wrapperPath);
  }
}

export function nativeCallerFromArguments(arguments_: string[]): string {
  const chromiumOrigin = arguments_.find((value) =>
    /^chrome-extension:\/\/[a-p]{32}\/?$/u.test(value),
  );
  if (chromiumOrigin) return canonicalChromiumOrigin(chromiumOrigin);
  return arguments_.find((value) => isFirefoxExtensionId(value)) ?? '';
}

export function extensionIdKind(value: string): 'chromium' | 'firefox' | undefined {
  if (/^[a-p]{32}$/u.test(value)) return 'chromium';
  if (isFirefoxExtensionId(value)) return 'firefox';
  return undefined;
}

function isTrustedNativeCaller(
  caller: string,
  browser: { chromiumExtensionIds: string[]; firefoxExtensionIds: string[] },
): boolean {
  const chromiumMatch = /^chrome-extension:\/\/([a-p]{32})\/?$/u.exec(caller);
  if (chromiumMatch) return browser.chromiumExtensionIds.includes(chromiumMatch[1]);
  return browser.firefoxExtensionIds.includes(caller);
}

function chromiumExtensionOrigin(id: string): string {
  return `chrome-extension://${id}/`;
}

function canonicalChromiumOrigin(origin: string): string {
  return origin.endsWith('/') ? origin : `${origin}/`;
}

function isFirefoxExtensionId(value: string): boolean {
  return /^(?:[a-z0-9._-]+@[a-z0-9._-]+|\{[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\})$/iu.test(
    value,
  );
}

function supportedPlatform(platform: NodeJS.Platform): NativeHostPlatform {
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') return platform;
  throw new Error(`Native messaging host installation is not supported on ${platform}.`);
}

function resolveCliEntry(): string {
  return resolveDistributionEntry('cli.cjs') ?? path.resolve(__dirname, '..', 'bin', 'conduit.js');
}

function resolveTargetPath(candidate: string, platform: NodeJS.Platform): string {
  if (platform === 'win32' && path.win32.isAbsolute(candidate)) {
    return path.win32.normalize(candidate);
  }
  return path.resolve(candidate);
}

function runCommand(command: string, args: string[]): NativeHostCommandResult {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error } : {}),
  };
}

function commandError(command: string, result: NativeHostCommandResult): Error {
  const detail =
    result.stderr.trim() || result.stdout.trim() || `exit code ${String(result.status)}`;
  return new Error(`${command} failed: ${detail}`);
}

function manifestMatches(manifestPath: string, expected: Record<string, unknown>): boolean {
  try {
    const actual = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

function batchQuoted(value: string): string {
  if (value.includes('"') || /[\r\n]/u.test(value)) {
    throw new Error('Native host executable paths contain unsupported characters.');
  }
  return `"${value.replaceAll('%', '%%')}"`;
}

function shellQuoted(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
