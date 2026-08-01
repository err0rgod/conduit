import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '@conduit/config';
import { LocalAuth } from '@conduit/security';
import { SetupManager } from '../src/setup';

describe('SetupManager', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('initializes configuration, authentication, service registration, and the daemon', async () => {
    const directory = temporaryDirectory();
    const configStore = new ConfigStore({ configPath: path.join(directory, 'config.json') });
    let serviceInstalled = false;
    let daemonStarted = false;
    const manager = new SetupManager({
      configStore,
      auth: new LocalAuth({ configPath: path.join(directory, 'auth.json') }),
      lifecycle: {
        start: async () => ((daemonStarted = true), { running: true, message: 'started' }),
        status: async () => ({ running: false, message: 'offline' }),
        stop: async () => ({ running: false, message: 'stopped' }),
      },
      service: {
        install: () => ((serviceInstalled = true), serviceResult(true)),
        uninstall: () => serviceResult(false),
      },
      dataDirectory: directory,
      extensionPath: path.join(directory, 'extension'),
      client: {
        startExtensionPairing: async () => ({ code: 'ABCDEFG2HJKL', expiresAt: 2_000 }),
      },
    });

    const report = await manager.setup();
    expect(fs.existsSync(configStore.getPath())).toBe(true);
    expect(fs.existsSync(path.join(directory, 'auth.json'))).toBe(true);
    expect({ serviceInstalled, daemonStarted }).toEqual({
      serviceInstalled: true,
      daemonStarted: true,
    });
    expect(report.nextSteps.join(' ')).toContain('Load unpacked');
    expect(report.extensionPairing?.code).toBe('ABCDEFG2HJKL');
  });

  it('preserves user data unless purge is explicitly requested', async () => {
    const directory = temporaryDirectory();
    const marker = path.join(directory, 'settings.json');
    fs.writeFileSync(marker, '{}');
    const manager = new SetupManager({
      lifecycle: {
        start: async () => ({ running: true, message: 'started' }),
        status: async () => ({ running: false, message: 'offline' }),
        stop: async () => ({ running: false, message: 'stopped' }),
      },
      service: { install: () => serviceResult(true), uninstall: () => serviceResult(false) },
      dataDirectory: directory,
      extensionPath: path.join(directory, 'extension'),
    });

    expect((await manager.uninstall()).dataRemoved).toBe(false);
    expect(fs.existsSync(marker)).toBe(true);
    expect((await manager.uninstall({ purge: true })).dataRemoved).toBe(true);
    expect(fs.existsSync(directory)).toBe(false);
  });

  function temporaryDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-setup-'));
    directories.push(directory);
    return directory;
  }
});

function serviceResult(installed: boolean) {
  return { platform: 'linux' as const, installed, message: installed ? 'installed' : 'removed' };
}
