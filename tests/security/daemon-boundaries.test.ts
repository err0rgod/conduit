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

  it('requires upload confirmation before inspecting an authorized path', async () => {
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

    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    if (!body.success) expect(body.error.code).toBe('USER_CONFIRMATION_REQUIRED');
  });
});

function postAction(port: number, token: string, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/action`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function quietAudit(): AuditLogger {
  return new AuditLogger({ sink: () => undefined });
}
