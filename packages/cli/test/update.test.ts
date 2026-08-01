import { describe, expect, it } from 'vitest';
import { UpdateManager } from '../src/update';

describe('UpdateManager', () => {
  it('checks the registry without changing the installation', async () => {
    const manager = new UpdateManager({
      currentVersion: '0.1.0',
      fetch: async () => new Response(JSON.stringify({ version: '0.2.0' })),
      run: () => {
        throw new Error('should not run');
      },
    });
    await expect(manager.check()).resolves.toMatchObject({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      updateAvailable: true,
      installed: false,
    });
  });

  it('pins the exact registry version during an upgrade', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const manager = new UpdateManager({
      currentVersion: '0.1.0',
      platform: 'linux',
      fetch: async () => new Response(JSON.stringify({ version: '0.2.0' })),
      run: (command, args) => calls.push({ command, args }),
    });
    await expect(manager.upgrade()).resolves.toMatchObject({
      latestVersion: '0.2.0',
      installed: true,
    });
    expect(calls).toEqual([
      { command: 'npm', args: ['install', '--global', 'conduit-browser@0.2.0'] },
    ]);
  });

  it('does not reinstall the current version', async () => {
    const manager = new UpdateManager({
      currentVersion: '0.1.0',
      fetch: async () => new Response(JSON.stringify({ version: '0.1.0' })),
      run: () => {
        throw new Error('should not run');
      },
    });
    await expect(manager.upgrade()).resolves.toMatchObject({
      updateAvailable: false,
      installed: false,
    });
  });
});
