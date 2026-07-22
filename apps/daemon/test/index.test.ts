import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Daemon } from '../src/index';
import {
  PROTOCOL_VERSION,
  ResponseEnvelope,
  createEnvelopeBase,
  createSuccessResponse,
} from '@conduit/protocol';
import WebSocket from 'ws';

describe('Daemon', () => {
  let daemon: Daemon;
  let port: number;

  beforeAll(async () => {
    daemon = new Daemon({ requestTimeoutMs: 500 });
    port = await daemon.start(0);
  });

  afterAll(async () => {
    await daemon.stop();
  });

  it('starts on localhost and exposes health', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      extensionConnected: false,
    });
  });

  it('rejects unauthenticated extension messages', () => {
    return new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'browser.list_tabs' }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as { type: string; error: { code: string } };
        expect(msg.type).toBe('error');
        expect(msg.error.code).toBe('AUTHENTICATION_FAILED');
        ws.close();
        resolve();
      });
    });
  });

  it('accepts valid extension authentication', async () => {
    const ws = await connectExtension(port, daemon.getToken());

    expect(daemon.isExtensionConnected()).toBe(true);
    ws.close();
  });

  it('rejects HTTP browser requests without a local token', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...createEnvelopeBase(),
        type: 'browser.list_tabs',
      }),
    });
    const body = (await response.json()) as ResponseEnvelope;

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    if (!body.success) {
      expect(body.error.code).toBe('AUTHENTICATION_REQUIRED');
    }
  });

  it('rejects malformed HTTP browser requests', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${daemon.getToken()}`,
      },
      body: JSON.stringify({
        id: 'not-a-uuid',
        timestamp: Date.now(),
        version: PROTOCOL_VERSION,
        type: 'browser.list_tabs',
      }),
    });
    const body = (await response.json()) as ResponseEnvelope;

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    if (!body.success) {
      expect(body.error.code).toBe('INVALID_REQUEST');
    }
  });

  it('forwards validated browser requests to the authenticated extension', async () => {
    const ws = await connectExtension(port, daemon.getToken());
    const responsePromise = onceExtensionRequest(ws, 'browser.list_tabs');

    const fetchPromise = fetch(`http://127.0.0.1:${port}/api/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${daemon.getToken()}`,
      },
      body: JSON.stringify({
        ...createEnvelopeBase(),
        type: 'browser.list_tabs',
      }),
    });

    const extensionRequest = await responsePromise;
    ws.send(JSON.stringify(createSuccessResponse({ tabs: [] }, extensionRequest.id)));

    const response = await fetchPromise;
    const body = (await response.json()) as ResponseEnvelope;
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    if (body.success) {
      expect(body.payload).toEqual({ tabs: [] });
    }

    ws.close();
  });
});

async function connectExtension(port: number, token: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);

  await new Promise<void>((resolve) => {
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', payload: { token } }));
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string };
      if (msg.type === 'auth_success') {
        resolve();
      }
    });
  });

  return ws;
}

async function onceExtensionRequest(
  ws: WebSocket,
  expectedType: string,
): Promise<{ id: string; type: string; payload?: unknown }> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      const message = JSON.parse(data.toString()) as {
        id: string;
        type: string;
        payload?: unknown;
      };
      expect(message.type).toBe(expectedType);
      resolve(message);
    });
  });
}
