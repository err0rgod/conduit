import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { NativeHostInstaller } from '../src/native-host';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

let mockHomeDir = '';
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => mockHomeDir,
  };
});

describe('NativeHostInstaller', () => {
  const directories: string[] = [];

  beforeEach(() => {
    mockHomeDir = temporaryDirectory();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('installs and uninstalls the native messaging host', () => {
    const installer = new NativeHostInstaller();

    expect(installer.status().installed).toBe(false);

    const installResult = installer.install();
    expect(installResult.installed).toBe(true);
    expect(installer.status().installed).toBe(true);

    const uninstallResult = installer.uninstall();
    expect(uninstallResult.installed).toBe(false);
    expect(installer.status().installed).toBe(false);
  });

  function temporaryDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-native-host-'));
    directories.push(directory);
    return directory;
  }
});
