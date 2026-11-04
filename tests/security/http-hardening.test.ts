import * as http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Daemon } from '../../apps/daemon/src/index';
import {
  isAllowedHost,
  isAllowedWebSocketOrigin,
  parseHostHeader,
} from '../../apps/daemon/src/request-guard';
import { AuditLogger } from '../../packages/security/src/index';

const daemons: Daemon[] = [];

afterEach(async () => {
  await Promise.all(daemons.splice(0).map((daemon) => daemon.stop()));
});

async function startDaemon(): Promise<{ daemon: Daemon; port: number }> {
  const daemon = new Daemon({ audit: new AuditLogger({ sink: () => undefined }) });
  daemons.push(daemon);
  const port = await daemon.start(0);
  return { daemon, port };
}

function rawGet(
  port: number,
  path: string,
  host: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { Host: host } },
      (response) => {
        let body = '';
        response.on('data', (chunk: Buffer) => (body += chunk.toString()));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

function openSocket(
  port: number,
  headers: Record<string, string>,
): Promise<{ opened: boolean; status?: number }> {
  return new Promise((resolve) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: '/',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        ...headers,
      },
    });
    request.on('upgrade', (_response, socket) => {
      socket.destroy();
      resolve({ opened: true });
    });
    request.on('response', (response) => {
      response.resume();
      resolve({ opened: false, status: response.statusCode });
    });
    request.on('error', () => resolve({ opened: false }));
    request.end();
  });
}

describe('DNS-rebinding defense on the HTTP listener', () => {
  it('rejects a foreign Host header on every endpoint including /health', async () => {
    const { port } = await startDaemon();
    for (const target of ['/health', '/api/action', '/nope']) {
      const response = await rawGet(port, target, `evil.example:${port}`);
      expect(response.status).toBe(403);
      expect(response.body).toContain('PERMISSION_DENIED');
    }
  });

  it('rejects a loopback name on the wrong port and a missing Host port', async () => {
    const { port } = await startDaemon();
    expect((await rawGet(port, '/health', `127.0.0.1:${port + 1}`)).status).toBe(403);
    expect((await rawGet(port, '/health', '127.0.0.1')).status).toBe(403);
  });

  it.each(['127.0.0.1', 'localhost', '[::1]', 'LOCALHOST'])(
    'accepts Host %s with the port',
    async (name) => {
      const { port } = await startDaemon();
      const response = await rawGet(port, '/health', `${name}:${port}`);
      expect(response.status).toBe(200);
    },
  );

  it('accepts the default Host sent by the Node fetch client', async () => {
    const { port } = await startDaemon();
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
  });
});

describe('WebSocket origin defense', () => {
  it('rejects web origins and foreign hosts', async () => {
    const { port } = await startDaemon();
    expect(await openSocket(port, { Origin: 'https://evil.example' })).toEqual({
      opened: false,
      status: 403,
    });
    expect(await openSocket(port, { Origin: `http://localhost:${port}` })).toEqual({
      opened: false,
      status: 403,
    });
    expect(await openSocket(port, { Host: `evil.example:${port}` })).toEqual({
      opened: false,
      status: 403,
    });
  });

  it('accepts Chrome and Firefox extension origins and clients without an Origin', async () => {
    const { port } = await startDaemon();
    const chrome = await openSocket(port, {
      Origin: 'chrome-extension://jkdlmcpkgkooilffjegfjmkanoelbmbl',
    });
    const firefox = await openSocket(port, {
      Origin: 'moz-extension://5b1a3c1e-1f2a-4c55-9a52-7a1d5f0e1b11',
    });
    expect(chrome.opened).toBe(true);
    expect(firefox.opened).toBe(true);
    expect((await openSocket(port, {})).opened).toBe(true);
  });
});

describe('request guard helpers', () => {
  const local = { secure: false, bindAddress: '127.0.0.1', remoteEnabled: false, allowedHosts: [] };
  const remote = {
    secure: true,
    bindAddress: '0.0.0.0',
    remoteEnabled: true,
    allowedHosts: ['Box.tailnet.ts.net'],
  };

  it.each([
    ['127.0.0.1:9222', 9222, local, true],
    ['localhost:9222', 9222, local, true],
    ['[::1]:9222', 9222, local, true],
    ['localhost.:9222', 9222, local, true],
    ['127.0.0.1:9223', 9222, local, false],
    ['evil.example:9222', 9222, local, false],
    ['127.0.0.1.evil.example:9222', 9222, local, false],
    ['localhost.evil.example:9222', 9222, local, false],
    ['192.168.1.5:9222', 9222, local, false],
    ['127.0.0.1@evil.example:9222', 9222, local, false],
    ['127.0.0.1:9222/x', 9222, local, false],
    ['', 9222, local, false],
    [undefined, 9222, local, false],
    ['[::1', 9222, local, false],
    ['::1:9222', 9222, local, false],
    ['localhost:99999', 9222, local, false],
    ['localhost', 80, local, true],
    ['192.168.1.5:443', 443, remote, true],
    ['box.tailnet.ts.net:443', 443, remote, true],
    ['evil.example:443', 443, remote, false],
    ['localhost:443', 443, remote, true],
  ] as const)('isAllowedHost(%s, port %s)', (host, port, options, expected) => {
    expect(isAllowedHost(host, port, options)).toBe(expected);
  });

  it('parses Host headers strictly', () => {
    expect(parseHostHeader('Example.com:80')).toEqual({ hostname: 'example.com', port: 80 });
    expect(parseHostHeader('[::1]:9')).toEqual({ hostname: '::1', port: 9 });
    expect(parseHostHeader('a b')).toBeUndefined();
  });

  it.each([
    [undefined, true],
    ['chrome-extension://jkdlmcpkgkooilffjegfjmkanoelbmbl', true],
    ['moz-extension://5b1a3c1e-1f2a-4c55-9a52-7a1d5f0e1b11', true],
    ['https://example.com', false],
    ['http://localhost:9222', false],
    ['null', false],
    ['file://', false],
    ['chrome-extension://x/evil', false],
  ])('isAllowedWebSocketOrigin(%s)', (origin, expected) => {
    expect(isAllowedWebSocketOrigin(origin)).toBe(expected);
  });
});
