import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '@conduit/config';
import { ConduitClient } from '@conduit/daemon-client';
import { LocalAuth } from '@conduit/security';
import { createProgram } from '../src/index';
import { DaemonLifecycle } from '../src/lifecycle';

describe('Conduit CLI', () => {
  let directory: string;
  let configStore: ConfigStore;
  let output: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-cli-'));
    configStore = new ConfigStore({ configPath: path.join(directory, 'config.json') });
    configStore.save({});
    output = '';
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  it('updates known configuration values and emits JSON when requested', async () => {
    await program().parseAsync([
      'node',
      'conduit',
      '--json',
      'config',
      'set',
      'daemon.port',
      '9555',
    ]);
    expect(configStore.load().daemon.port).toBe(9555);
    expect(JSON.parse(output)).toMatchObject({ daemon: { port: 9555 } });
  });

  it('moves a domain between block and allow policies', async () => {
    await program().parseAsync(['node', 'conduit', 'deny-domain', 'Example.COM']);
    expect(configStore.load().security.blockedDomains).toEqual(['example.com']);
    output = '';
    await program().parseAsync(['node', 'conduit', 'allow-domain', 'example.com']);
    expect(configStore.load().security.allowedDomains).toEqual(['example.com']);
    expect(configStore.load().security.blockedDomains).toEqual([]);
    expect(output).toContain('allowedDomains');
  });

  it('parses browser targets and sends a validated action', async () => {
    let requestBody: unknown;
    const client = new ConduitClient({
      token: 'test-token',
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            version: '1.0',
            correlationId: (requestBody as { id: string }).id,
            success: true,
            payload: { clicked: true },
          }),
        );
      },
    });
    await program(client).parseAsync([
      'node',
      'conduit',
      '--json',
      'browser',
      'click',
      '--tab',
      '7',
      '--element',
      'e3',
    ]);
    expect(requestBody).toMatchObject({
      type: 'browser.click',
      payload: { tabId: 7, target: { elementId: 'e3' } },
    });
    expect(JSON.parse(output)).toMatchObject({ success: true });
  });

  it('creates a short-lived extension pairing code without revealing the local token', async () => {
    const client = new ConduitClient({
      token: 'unused',
      fetch: async () => new Response(JSON.stringify({ code: 'ABCDEFG2HJKL', expiresAt: 2_000 })),
    });
    await program(client).parseAsync(['node', 'conduit', '--json', 'extension', 'pair']);
    expect(JSON.parse(output)).toEqual({ code: 'ABCDEFG2HJKL', expiresAt: 2_000 });
  });

  function program(client = new ConduitClient({ token: 'unused' })) {
    const lifecycle = new DaemonLifecycle({
      configStore,
      statePath: path.join(directory, 'state.json'),
      logPath: path.join(directory, 'daemon.log'),
      daemonEntryPath: path.join(directory, 'missing.js'),
      auth: new LocalAuth({ configPath: path.join(directory, 'auth.json') }),
    });
    return createProgram({
      client,
      configStore,
      lifecycle,
      stdout: { write: (chunk) => ((output += String(chunk)), true) },
    });
  }
});
