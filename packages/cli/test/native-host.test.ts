import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { ConduitConfigSchema } from '@conduit/config';
import {
  EXPECTED_EXTENSION_ORIGIN,
  MAX_NATIVE_REQUEST_BYTES,
  NATIVE_HOST_NAME,
  NativeHostCommandResult,
  NativeHostInstaller,
  encodeNativeMessage,
  parseNativeRequest,
  readNativeMessage,
  runNativeHost,
} from '../src/native-host';

describe('native messaging protocol', () => {
  it('parses a bounded length-prefixed JSON request', async () => {
    const request = { type: 'conduit.get-connection-settings', protocolVersion: 1 };
    await expect(readNativeMessage(Readable.from([encodeNativeMessage(request)]))).resolves.toEqual(
      request,
    );
    expect(parseNativeRequest(request)).toEqual(request);
  });

  it('rejects malformed, truncated, oversized, and trailing frames', async () => {
    const truncated = Buffer.alloc(6);
    truncated.writeUInt32LE(10, 0);
    await expect(readNativeMessage(Readable.from([truncated]))).rejects.toThrow(
      'ended before the declared payload',
    );

    const oversized = Buffer.alloc(4);
    oversized.writeUInt32LE(MAX_NATIVE_REQUEST_BYTES + 1, 0);
    await expect(readNativeMessage(Readable.from([oversized]))).rejects.toThrow(
      'exceeds the configured limit',
    );

    const invalidJson = Buffer.concat([Buffer.from([1, 0, 0, 0]), Buffer.from('{')]);
    await expect(readNativeMessage(Readable.from([invalidJson]))).rejects.toThrow('not valid JSON');

    const valid = encodeNativeMessage({
      type: 'conduit.get-connection-settings',
      protocolVersion: 1,
    });
    await expect(
      readNativeMessage(Readable.from([Buffer.concat([valid, Buffer.from('extra')])])),
    ).rejects.toThrow('unexpected trailing bytes');
  });

  it('rejects unknown fields, request types, and protocol versions', () => {
    expect(() =>
      parseNativeRequest({ type: 'conduit.get-connection-settings', protocolVersion: 2 }),
    ).toThrow('unsupported protocol version');
    expect(() => parseNativeRequest({ type: 'unexpected', protocolVersion: 1 })).toThrow(
      'unsupported protocol version',
    );
    expect(() =>
      parseNativeRequest({
        type: 'conduit.get-connection-settings',
        protocolVersion: 1,
        token: 'page-controlled',
      }),
    ).toThrow('unsupported protocol version');
  });

  it('returns connection settings only to the pinned extension origin', async () => {
    const outputChunks: Buffer[] = [];
    const output = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        outputChunks.push(Buffer.from(chunk));
        callback();
      },
    });
    await runNativeHost(EXPECTED_EXTENSION_ORIGIN, {
      input: Readable.from([
        encodeNativeMessage({ type: 'conduit.get-connection-settings', protocolVersion: 1 }),
      ]),
      output,
      configStore: { load: () => ConduitConfigSchema.parse({ daemon: { port: 9_333 } }) },
      auth: { ensureToken: () => 'a'.repeat(64) },
    });

    const response = (await readNativeMessage(Readable.from(outputChunks))) as Record<
      string,
      unknown
    >;
    expect(response).toEqual({
      type: 'conduit.connection-settings',
      protocolVersion: 1,
      daemonPort: 9_333,
      daemonToken: 'a'.repeat(64),
    });

    await expect(
      runNativeHost('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/', {
        input: Readable.from([]),
        output,
      }),
    ).rejects.toThrow('unauthorized extension origin');
  });
});

describe('NativeHostInstaller', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['linux' as const, '.config/google-chrome/NativeMessagingHosts'],
    ['darwin' as const, 'Library/Application Support/Google/Chrome/NativeMessagingHosts'],
  ])('installs and removes verified %s manifests', (platform, expectedSegment) => {
    const homeDirectory = temporaryDirectory();
    const installer = new NativeHostInstaller({
      platform,
      homeDirectory,
      nodePath: path.join(homeDirectory, 'node'),
      cliEntryPath: path.join(homeDirectory, 'cli.cjs'),
    });

    expect(installer.status().installed).toBe(false);
    const installed = installer.install();
    expect(installed.installed).toBe(true);
    expect(installed.manifestPaths).toHaveLength(4);
    expect(installed.manifestPaths?.[0].replaceAll('\\', '/')).toContain(expectedSegment);
    for (const manifestPath of installed.manifestPaths ?? []) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        allowed_origins: string[];
        path: string;
      };
      expect(manifest.allowed_origins).toEqual([EXPECTED_EXTENSION_ORIGIN]);
      expect(path.isAbsolute(manifest.path)).toBe(true);
    }
    expect(installer.uninstall().installed).toBe(false);
    expect(installer.status().installed).toBe(false);
  });

  it('registers and verifies Chrome, Edge, and Chromium under HKCU on Windows', () => {
    const homeDirectory = temporaryDirectory();
    const registry = new FakeRegistry();
    const installer = new NativeHostInstaller({
      platform: 'win32',
      homeDirectory,
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      cliEntryPath: 'C:\\Users\\test user\\conduit\\cli.cjs',
      run: registry.run,
    });

    const installed = installer.install();
    expect(installed.installed).toBe(true);
    expect(registry.values.size).toBe(3);
    expect(installer.status().installed).toBe(true);
    const wrapper = fs.readFileSync(installer.platformPaths().wrapperPath, 'utf8');
    expect(wrapper).toContain('"C:\\Program Files\\nodejs\\node.exe"');
    expect(wrapper).toContain('"C:\\Users\\test user\\conduit\\cli.cjs"');
    expect(wrapper).toContain('extension native-host %*');

    expect(installer.uninstall().installed).toBe(false);
    expect(registry.values.size).toBe(0);
  });

  it('rolls back files and reports failure when registry registration fails', () => {
    const homeDirectory = temporaryDirectory();
    const installer = new NativeHostInstaller({
      platform: 'win32',
      homeDirectory,
      nodePath: 'C:\\node.exe',
      cliEntryPath: 'C:\\conduit\\cli.cjs',
      run: (_command, args) =>
        args[0] === 'ADD'
          ? { status: 5, stdout: '', stderr: 'access denied' }
          : { status: 1, stdout: '', stderr: '' },
    });

    const result = installer.install();
    expect(result.installed).toBe(false);
    expect(result.message).toContain('access denied');
    expect(fs.existsSync(installer.platformPaths().wrapperPath)).toBe(false);
    expect(fs.existsSync(installer.platformPaths().manifestPaths[0])).toBe(false);
  });

  function temporaryDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-native-host-'));
    directories.push(directory);
    return directory;
  }
});

class FakeRegistry {
  public readonly values = new Map<string, string>();

  public readonly run = (_command: string, args: string[]): NativeHostCommandResult => {
    const operation = args[0];
    const key = args[1];
    if (operation === 'ADD') {
      this.values.set(key, args[args.indexOf('/d') + 1]);
      return success();
    }
    if (operation === 'QUERY') {
      const value = this.values.get(key);
      return value
        ? { status: 0, stdout: `${key} REG_SZ ${value}`, stderr: '' }
        : { status: 1, stdout: '', stderr: 'not found' };
    }
    if (operation === 'DELETE') {
      return { status: this.values.delete(key) ? 0 : 1, stdout: '', stderr: '' };
    }
    return { status: 2, stdout: '', stderr: 'unexpected command' };
  };
}

function success(): NativeHostCommandResult {
  return { status: 0, stdout: '', stderr: '' };
}
