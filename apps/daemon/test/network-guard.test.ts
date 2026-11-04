import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { Daemon } from '../src/index';
import { createEnvelopeBase, createSuccessResponse, ResponseEnvelope } from '@conduit/protocol';
import { AuditLogger, SecurityPolicy } from '@conduit/security';

const daemons: Daemon[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await Promise.all(daemons.splice(0).map((daemon) => daemon.stop()));
});

interface FakeExtension {
  tabs: Array<{ id: number; url: string; title: string; active: boolean }>;
  received: string[];
}

function policy(): SecurityPolicy {
  return new SecurityPolicy({
    permissions: ['browser.read', 'browser.navigate', 'browser.interact'],
    domainMode: 'allowlist',
    allowedDomains: ['example.com'],
  });
}

async function startDaemon(): Promise<{ daemon: Daemon; port: number }> {
  const daemon = new Daemon({
    policy: policy(),
    audit: new AuditLogger({ sink: () => undefined }),
  });
  daemons.push(daemon);
  return { daemon, port: await daemon.start(0) };
}

/** A scripted extension: answers list_tabs from `state.tabs` and echoes everything else. */
async function connectFakeExtension(
  port: number,
  token: string,
  state: FakeExtension,
): Promise<void> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(ws);
  await new Promise<void>((resolve) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', payload: { token } })));
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString()) as { type: string; id: string };
      if (message.type === 'auth_success') {
        resolve();
        return;
      }
      state.received.push(message.type);
      const payload = message.type === 'browser.list_tabs' ? { tabs: state.tabs } : { ok: true };
      ws.send(JSON.stringify(createSuccessResponse(payload, message.id)));
    });
  });
}

async function act(port: number, token: string, type: string, payload: unknown = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api/action`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...createEnvelopeBase(), type, payload }),
  });
  return { status: response.status, body: (await response.json()) as ResponseEnvelope };
}

function errorCode(body: ResponseEnvelope): string | undefined {
  return body.success ? undefined : body.error.code;
}

describe('daemon fails closed on unknown or stale page URLs', () => {
  it('denies page-content actions when no tab URL is known', async () => {
    const { daemon, port } = await startDaemon();
    const result = await act(port, daemon.getToken(), 'browser.snapshot');
    expect(result.status).toBe(403);
    expect(errorCode(result.body)).toBe('DOMAIN_NOT_ALLOWED');
    if (!result.body.success) {
      expect(result.body.error.message).toMatch(/list tabs or navigate/iu);
    }
  });

  it('denies when the extension reports an empty tab URL', async () => {
    const { daemon, port } = await startDaemon();
    const state: FakeExtension = {
      tabs: [{ id: 1, url: '', title: '', active: true }],
      received: [],
    };
    await connectFakeExtension(port, daemon.getToken(), state);
    const result = await act(port, daemon.getToken(), 'browser.click', {
      target: { elementId: 'e1' },
    });
    expect(result.status).toBe(403);
    expect(errorCode(result.body)).toBe('DOMAIN_NOT_ALLOWED');
    expect(state.received).toEqual(['browser.list_tabs']);
  });

  it('re-reads the live tab URL instead of trusting a stale cache', async () => {
    const { daemon, port } = await startDaemon();
    const state: FakeExtension = {
      tabs: [{ id: 1, url: 'https://example.com/', title: 'ok', active: true }],
      received: [],
    };
    await connectFakeExtension(port, daemon.getToken(), state);

    const allowed = await act(port, daemon.getToken(), 'browser.snapshot');
    expect(allowed.status).toBe(200);

    // The page navigates itself (redirect, user action, script) to a disallowed
    // site and to the cloud-metadata address without the daemon being told.
    for (const url of ['https://evil.test/', 'http://[::ffff:a9fe:a9fe]/latest/meta-data/']) {
      state.tabs = [{ id: 1, url, title: 'moved', active: true }];
      state.received.length = 0;
      const denied = await act(port, daemon.getToken(), 'browser.snapshot');
      expect(denied.status).toBe(403);
      expect(errorCode(denied.body)).toBe('DOMAIN_NOT_ALLOWED');
      // Only the lookup reached the extension; the snapshot itself did not.
      expect(state.received).toEqual(['browser.list_tabs']);
    }
  });

  it('still requires upload confirmation once the live URL is allowed', async () => {
    const daemon = new Daemon({
      policy: new SecurityPolicy({
        permissions: ['browser.upload'],
        domainMode: 'allowlist',
        allowedDomains: ['example.com'],
      }),
      audit: new AuditLogger({ sink: () => undefined }),
    });
    daemons.push(daemon);
    const port = await daemon.start(0);
    const state: FakeExtension = {
      tabs: [{ id: 1, url: 'https://example.com/', title: 'ok', active: true }],
      received: [],
    };
    await connectFakeExtension(port, daemon.getToken(), state);
    const result = await act(port, daemon.getToken(), 'browser.upload_file', {
      target: { elementId: 'e1' },
      files: ['C:\\missing-private.txt'],
    });
    expect(result.status).toBe(409);
    expect(errorCode(result.body)).toBe('USER_CONFIRMATION_REQUIRED');
    expect(state.received).toEqual(['browser.list_tabs']);
  });

  it('keeps list_tabs available without a known URL', async () => {
    const { daemon, port } = await startDaemon();
    const state: FakeExtension = { tabs: [], received: [] };
    await connectFakeExtension(port, daemon.getToken(), state);
    const result = await act(port, daemon.getToken(), 'browser.list_tabs');
    expect(result.status).toBe(200);
  });
});

describe('daemon rejects non-http(s) navigation in every domain mode', () => {
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'chrome://settings/'])(
    'blocks %s for navigate and open_tab',
    async (url) => {
      for (const domainMode of ['allow-all', 'blocklist', 'allowlist', 'ask'] as const) {
        const daemon = new Daemon({
          policy: new SecurityPolicy({
            permissions: ['browser.navigate'],
            domainMode,
            allowedDomains: ['example.com'],
          }),
          audit: new AuditLogger({ sink: () => undefined }),
        });
        daemons.push(daemon);
        const port = await daemon.start(0);
        const state: FakeExtension = { tabs: [], received: [] };
        await connectFakeExtension(port, daemon.getToken(), state);
        for (const type of ['browser.navigate', 'browser.open_tab']) {
          const result = await act(port, daemon.getToken(), type, { url });
          expect(result.status).toBe(403);
          expect(errorCode(result.body)).toBe('DOMAIN_NOT_ALLOWED');
        }
        expect(state.received).toEqual([]);
      }
    },
  );

  it('blocks view-source: URLs', async () => {
    const { daemon, port } = await startDaemon();
    const result = await act(port, daemon.getToken(), 'browser.navigate', {
      url: 'view-source:https://example.com/',
    });
    expect(result.status).toBe(403);
    expect(errorCode(result.body)).toBe('DOMAIN_NOT_ALLOWED');
  });
});
