import { afterEach, describe, expect, it } from 'vitest';
import { Daemon } from '../../apps/daemon/src/index';
import { createEnvelopeBase, ResponseEnvelope } from '../../packages/protocol/src/index';
import { AuditLogger, SecurityPolicy } from '../../packages/security/src/index';

const daemons: Daemon[] = [];

afterEach(async () => {
  await Promise.all(daemons.splice(0).map((daemon) => daemon.stop()));
});

describe('daemon security boundaries', () => {
  it('rejects oversized bodies with a stable protocol error', async () => {
    const daemon = new Daemon({ maxBodyBytes: 128, audit: quietAudit() });
    daemons.push(daemon);
    const port = await daemon.start(0);
    const response = await fetch(`http://127.0.0.1:${port}/api/action`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${daemon.getToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ padding: 'x'.repeat(256) }),
    });
    const body = (await response.json()) as ResponseEnvelope;

    expect(response.status).toBe(413);
    expect(body.success).toBe(false);
    if (!body.success) expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('blocks unlisted domains before a request reaches the extension', async () => {
    const daemon = new Daemon({
      policy: new SecurityPolicy({
        permissions: ['browser.navigate'],
        domainMode: 'allowlist',
        allowedDomains: ['example.com'],
      }),
      audit: quietAudit(),
    });
    daemons.push(daemon);
    const port = await daemon.start(0);
    const response = await postAction(port, daemon.getToken(), {
      ...createEnvelopeBase(),
      type: 'browser.navigate',
      payload: { url: 'https://blocked.invalid' },
    });
    const body = (await response.json()) as ResponseEnvelope;

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    if (!body.success) expect(body.error.code).toBe('DOMAIN_NOT_ALLOWED');
  });

  it('keeps blocked domains and private networks denied in allow-all mode', async () => {
    const daemon = new Daemon({
      policy: new SecurityPolicy({
        permissions: ['browser.navigate'],
        domainMode: 'allow-all',
        blockedDomains: ['blocked.example.com'],
      }),
      audit: quietAudit(),
    });
    daemons.push(daemon);
    const port = await daemon.start(0);

    for (const url of ['https://blocked.example.com', 'http://192.168.1.10']) {
      const response = await postAction(port, daemon.getToken(), {
        ...createEnvelopeBase(),
        type: 'browser.navigate',
        payload: { url },
      });
      const body = (await response.json()) as ResponseEnvelope;
      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
      if (!body.success) expect(body.error.code).toBe('DOMAIN_NOT_ALLOWED');
    }
  });

  it('denies file upload when the explicit upload permission is absent', async () => {
    const daemon = new Daemon({
      policy: new SecurityPolicy({ permissions: ['browser.read'] }),
      audit: quietAudit(),
    });
    daemons.push(daemon);
    const port = await daemon.start(0);
    const response = await postAction(port, daemon.getToken(), {
      ...createEnvelopeBase(),
      type: 'browser.upload_file',
      payload: { target: { elementId: 'e1' }, files: ['C:\\private.txt'] },
    });
    const body = (await response.json()) as ResponseEnvelope;

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    if (!body.success) expect(body.error.code).toBe('PERMISSION_DENIED');
  });

  it('fails closed on upload when the page URL is unknown, before any path inspection', async () => {
    const daemon = new Daemon({
      policy: new SecurityPolicy({ permissions: ['browser.upload'] }),
      audit: quietAudit(),
    });
    daemons.push(daemon);
    const port = await daemon.start(0);
    const response = await postAction(port, daemon.getToken(), {
      ...createEnvelopeBase(),
      type: 'browser.upload_file',
      payload: { target: { elementId: 'e1' }, files: ['C:\\missing-private.txt'] },
    });
    const body = (await response.json()) as ResponseEnvelope;

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    if (!body.success) expect(body.error.code).toBe('DOMAIN_NOT_ALLOWED');
  });

  it('binds a confirmation to the exact approved request', async () => {
    const events: Array<{ type: string; outcome: string }> = [];
    const daemon = new Daemon({
      policy: new SecurityPolicy({ permissions: ['browser.navigate'], domainMode: 'ask' }),
      audit: new AuditLogger({ sink: (event) => events.push(event) }),
    });
    daemons.push(daemon);
    const port = await daemon.start(0);
    const token = daemon.getToken();
    const navigate = (url: string) => ({
      ...createEnvelopeBase(),
      type: 'browser.navigate',
      payload: { url },
    });

    const pending = (await (
      await postAction(port, token, navigate('https://example.com/a'))
    ).json()) as ResponseEnvelope;
    if (pending.success) throw new Error('Expected a confirmation request.');
    const confirmationId = (pending.error.details?.confirmation as { id: string }).id;
    const approval = await fetch(`http://127.0.0.1:${port}/api/confirmations/respond`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${daemon.getExtensionCredential()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmationId, approved: true }),
    });
    expect(approval.status).toBe(200);

    // A different URL of the same operation type must not spend the approval.
    const hijack = await postAction(port, token, navigate('https://evil.example/'), confirmationId);
    const hijackBody = (await hijack.json()) as ResponseEnvelope;
    expect(hijack.status).toBe(409);
    if (!hijackBody.success) expect(hijackBody.error.code).toBe('USER_CONFIRMATION_REQUIRED');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'confirmation.consumed', outcome: 'denied' }),
    );

    // The exact request still passes the confirmation gate (no extension is
    // connected, so it stops at EXTENSION_DISCONNECTED), but only once.
    const exact = await postAction(port, token, navigate('https://example.com/a'), confirmationId);
    const exactBody = (await exact.json()) as ResponseEnvelope;
    expect(exact.status).toBe(503);
    if (!exactBody.success) expect(exactBody.error.code).toBe('EXTENSION_DISCONNECTED');
    const replay = await postAction(port, token, navigate('https://example.com/a'), confirmationId);
    expect(replay.status).toBe(409);
  });
});

function postAction(
  port: number,
  token: string,
  body: unknown,
  confirmationId?: string,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/action`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(confirmationId ? { 'X-Conduit-Confirmation': confirmationId } : {}),
    },
    body: JSON.stringify(body),
  });
}

function quietAudit(): AuditLogger {
  return new AuditLogger({ sink: () => undefined });
}
