import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ServiceCommand, UserService } from '../src/service';

describe('UserService', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('creates and enables a Linux user service with quoted executable paths', () => {
    const homeDirectory = temporaryDirectory();
    const commands: ServiceCommand[] = [];
    const service = new UserService({
      platform: 'linux',
      homeDirectory,
      nodePath: '/opt/Node Runtime/node',
      cliEntryPath: '/opt/Conduit App/cli.cjs',
      run: (command) => commands.push(command),
    });

    const result = service.install();
    expect(result.installed).toBe(true);
    expect(fs.readFileSync(service.definitionPath(), 'utf8')).toContain(
      'ExecStart="/opt/Node Runtime/node" "/opt/Conduit App/cli.cjs" start',
    );
    expect(commands).toEqual([
      { command: 'systemctl', args: ['--user', 'daemon-reload'] },
      { command: 'systemctl', args: ['--user', 'enable', 'conduit.service'] },
    ]);
  });

  it('writes a safe macOS LaunchAgent definition', () => {
    const homeDirectory = temporaryDirectory();
    const service = new UserService({
      platform: 'darwin',
      homeDirectory,
      nodePath: '/Applications/Node & Tools/node',
      cliEntryPath: '/Users/test/Conduit <current>/cli.cjs',
      run: () => undefined,
    });

    service.install();
    const definition = fs.readFileSync(service.definitionPath(), 'utf8');
    expect(definition).toContain('/Applications/Node &amp; Tools/node');
    expect(definition).toContain('/Users/test/Conduit &lt;current&gt;/cli.cjs');
    expect(definition).toContain('<key>RunAtLoad</key><true/>');
  });

  it('registers a limited Windows logon task without shell interpolation', () => {
    const commands: ServiceCommand[] = [];
    const service = new UserService({
      platform: 'win32',
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      cliEntryPath: 'C:\\Users\\test\\Conduit App\\cli.cjs',
      run: (command) => commands.push(command),
    });

    service.install();
    expect(commands).toEqual([
      {
        command: 'schtasks.exe',
        args: [
          '/Create',
          '/F',
          '/SC',
          'ONLOGON',
          '/TN',
          'Conduit Browser Bridge',
          '/TR',
          '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\test\\Conduit App\\cli.cjs" start',
          '/RL',
          'LIMITED',
        ],
      },
    ]);
  });

  function temporaryDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-service-'));
    directories.push(directory);
    return directory;
  }
});
