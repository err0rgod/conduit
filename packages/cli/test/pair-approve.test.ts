import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '@conduit/config';
import { ConduitClient } from '@conduit/daemon-client';
import { createProgram } from '../src/index';

const PENDING = {
  id: 'pairing-1',
  deviceName: 'Laptop',
  publicKey: 'AAAA',
  fingerprint: 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12',
  requestedPermissions: ['browser.read'],
  requestedAt: Date.now(),
  expiresAt: Date.now() + 60_000,
};

describe('conduit pair approve', () => {
  let directory: string;
  let configStore: ConfigStore;
  let output: string;
  let calls: Array<{ url: string; authorization: string | null }>;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-pair-'));
    configStore = new ConfigStore({ configPath: path.join(directory, 'config.json') });
    configStore.save({});
    output = '';
    calls = [];
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  function client(): ConduitClient {
    return new ConduitClient({
      token: 'agent-token',
      approvalToken: 'operator-credential',
      fetch: async (input, init) => {
        const url = String(input);
        calls.push({
          url,
          authorization: new Headers(init?.headers).get('authorization'),
        });
        if (url.endsWith('/api/pairings')) {
          return new Response(JSON.stringify({ pairings: [PENDING] }));
        }
        return new Response(JSON.stringify({ device: { id: 'device-1' } }), { status: 201 });
      },
    });
  }

  function program(stdin: PassThrough & { isTTY?: boolean }) {
    return createProgram({
      client: client(),
      configStore,
      stdin,
      stdout: {
        write: (chunk: string | Uint8Array) => {
          output += String(chunk);
          return true;
        },
      },
    });
  }

  it('refuses to approve when stdin is not an interactive terminal', async () => {
    const stdin: PassThrough & { isTTY?: boolean } = new PassThrough();
    stdin.isTTY = false;
    await expect(
      program(stdin).parseAsync(['node', 'conduit', 'pair', 'approve', 'pairing-1']),
    ).rejects.toThrow(/interactive terminal/u);
    expect(calls.some((call) => call.url.endsWith('/api/pairings/respond'))).toBe(false);
  });

  it('does not approve when the typed fingerprint does not match', async () => {
    const stdin: PassThrough & { isTTY?: boolean } = new PassThrough();
    stdin.isTTY = true;
    stdin.end('ffffffff\n');
    await expect(
      program(stdin).parseAsync(['node', 'conduit', 'pair', 'approve', 'pairing-1']),
    ).rejects.toThrow(/did not match/u);
    expect(calls.some((call) => call.url.endsWith('/api/pairings/respond'))).toBe(false);
  });

  it('approves with the operator credential after the fingerprint is typed', async () => {
    const stdin: PassThrough & { isTTY?: boolean } = new PassThrough();
    stdin.isTTY = true;
    stdin.end('AB:12:CD:34\n');
    await program(stdin).parseAsync(['node', 'conduit', '--json', 'pair', 'approve', 'pairing-1']);

    const approval = calls.find((call) => call.url.endsWith('/api/pairings/respond'));
    expect(approval?.authorization).toBe('Bearer operator-credential');
    expect(output).toContain('Fingerprint: ab12cd34');
  });

  it('denies with the agent token', async () => {
    const stdin: PassThrough & { isTTY?: boolean } = new PassThrough();
    await program(stdin).parseAsync(['node', 'conduit', '--json', 'pair', 'deny', 'pairing-1']);
    const denial = calls.find((call) => call.url.endsWith('/api/pairings/respond'));
    expect(denial?.authorization).toBe('Bearer agent-token');
  });
});
