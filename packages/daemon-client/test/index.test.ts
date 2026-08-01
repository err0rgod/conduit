import { describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import { ConduitClient, ConduitClientError } from '../src/index';
import { BrowserRequestEnvelopeSchema, createSuccessResponse } from '@conduit/protocol';

describe('ConduitClient', () => {
  it('sends authenticated, versioned browser requests', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(createSuccessResponse({ tabs: [] })), { status: 200 }),
      );
    const client = new ConduitClient({ token: 'a'.repeat(64), fetch: fetchMock });
    expect((await client.browser('browser.list_tabs')).success).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${'a'.repeat(64)}`);
    expect(BrowserRequestEnvelopeSchema.safeParse(JSON.parse(String(init?.body))).success).toBe(
      true,
    );
  });

  it('rejects daemon responses outside the shared protocol', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const client = new ConduitClient({ token: 'a'.repeat(64), fetch: fetchMock });
    await expect(client.browser('browser.list_tabs')).rejects.toBeInstanceOf(ConduitClientError);
  });

  it('validates health responses', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          extensionConnected: true,
          instanceId: '123e4567-e89b-12d3-a456-426614174000',
        }),
        { status: 200 },
      ),
    );
    const client = new ConduitClient({ token: 'a'.repeat(64), fetch: fetchMock });
    await expect(client.health()).resolves.toEqual({
      status: 'ok',
      extensionConnected: true,
      instanceId: '123e4567-e89b-12d3-a456-426614174000',
    });
  });

  it('manages pairing, devices, revocation, and graceful shutdown with local auth', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const pathname = new URL(String(input)).pathname;
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${'a'.repeat(64)}`);
      if (pathname === '/api/pairings/start') {
        return new Response(JSON.stringify({ code: 'ABCDEFG2', expiresAt: 2_000 }));
      }
      if (pathname === '/api/pairings') return new Response(JSON.stringify({ pairings: [] }));
      if (pathname === '/api/devices') return new Response(JSON.stringify({ devices: [] }));
      if (pathname === '/api/devices/revoke') {
        return new Response(JSON.stringify({ revoked: true }));
      }
      if (pathname === '/api/shutdown') return new Response(JSON.stringify({ stopping: true }));
      return new Response(JSON.stringify({ accepted: true }));
    });
    const client = new ConduitClient({ token: 'a'.repeat(64), fetch: fetchMock });
    await expect(client.startPairing()).resolves.toEqual({ code: 'ABCDEFG2', expiresAt: 2_000 });
    await expect(client.listPairings()).resolves.toEqual([]);
    await expect(client.listDevices()).resolves.toEqual([]);
    await expect(client.revokeDevice(crypto.randomUUID())).resolves.toBe(true);
    await expect(client.shutdown()).resolves.toBe(true);
  });
});
