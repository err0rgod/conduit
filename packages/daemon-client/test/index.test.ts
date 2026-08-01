import { describe, expect, it, vi } from 'vitest';
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
});
