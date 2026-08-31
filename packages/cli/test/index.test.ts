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

  it('sets the opt-in allow-all domain mode through validated config', async () => {
    await program().parseAsync([
      'node',
      'conduit',
      '--json',
      'config',
      'set',
      'security.domainMode',
      '"allow-all"',
    ]);
    expect(configStore.load().security.domainMode).toBe('allow-all');
    expect(JSON.parse(output)).toMatchObject({ security: { domainMode: 'allow-all' } });
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

  it('prints GitHub fallback extension and skill installation steps', async () => {
    await program().parseAsync(['node', 'conduit', '--json', 'extension', 'install-help']);

    expect(JSON.parse(output)).toMatchObject({
      steps: expect.arrayContaining([
        'Install the Conduit backend with the release script.',
        'Chrome Web Store listing is temporarily unavailable.',
        'Download the verified unpacked build: https://github.com/err0rgod/conduit-extension/releases/download/v0.1.3/conduit-extension-unpacked-v0.1.3.zip',
        'Extract it, open chrome://extensions, enable Developer mode, choose Load unpacked, and select the folder containing manifest.json.',
        'Firefox Add-ons (approved): https://addons.mozilla.org/en-US/firefox/addon/conduit/',
        'The unpacked development extension ID jkdlmcpkgkooilffjegfjmkanoelbmbl is trusted by default.',
        'Install the Conduit Agent Skill in your AI harness.',
      ]),
      skill: {
        directory: 'https://github.com/err0rgod/skills/tree/main/conduit',
        entry: 'https://raw.githubusercontent.com/err0rgod/skills/main/conduit/SKILL.md',
      },
    });
    expect(output).not.toContain('Clone https://github.com/err0rgod/conduit-extension');
  });

  it('trusts a validated Chromium store identity and refreshes Native Messaging', async () => {
    const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
    await program().parseAsync(['node', 'conduit', '--json', 'extension', 'trust', extensionId]);

    expect(configStore.load().browser.chromiumExtensionIds).toContain(extensionId);
    expect(JSON.parse(output)).toMatchObject({
      trusted: true,
      browser: 'chromium',
      extensionId,
      nativeHost: { installed: true },
    });
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
      nativeHostInstaller: { install: () => ({ installed: true }) },
      stdout: { write: (chunk) => ((output += String(chunk)), true) },
    });
  }
});
