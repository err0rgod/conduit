import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Daemon } from '../src/index';
import WebSocket from 'ws';

describe('Daemon', () => {
  let daemon: Daemon;
  let port: number;

  beforeAll(async () => {
    daemon = new Daemon();
    port = await daemon.start(0);
  });

  afterAll(async () => {
    await daemon.stop();
  });

  it('starts on localhost', () => {
    expect(port).toBeGreaterThan(0);
  });

  it('rejects unauthenticated messages', () => {
    return new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'do_something' }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg.type).toBe('error');
        expect(msg.error.code).toBe('AUTHENTICATION_FAILED');
        resolve();
      });
    });
  });

  it('accepts valid authentication', () => {
    return new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'auth',
            payload: { token: daemon.getToken() },
          }),
        );
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth_success') {
          resolve();
        }
      });
    });
  });
});
