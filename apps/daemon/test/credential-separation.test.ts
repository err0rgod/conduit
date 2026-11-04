import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Daemon } from '../src/index';
import { createEnvelopeBase, ResponseEnvelope } from '@conduit/protocol';
import {
  AuditLogger,
  LocalAuth,
  SecurityPolicy,
  StoredAuditEvent,
  TrustedDeviceStore,
  computeDaemonProof,
} from '@conduit/security';

interface Harness {
  daemon: Daemon;
  port: number;
  auth: LocalAuth;
  events: Array<{ type: string; outcome: string; details?: Record<string, unknown> }>;
}

let directory: string;
const daemons: Daemon[] = [];
const sockets: WebSocket[] = [];

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-credsep-'));
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await Promise.all(daemons.splice(0).map((daemon) => daemon.stop()));
  fs.rmSync(directory, { recursive: true, force: true });
});

async function start(options: ConstructorParameters<typeof Daemon>[0] = {}): Promise<Harness> {
  const auth = new LocalAuth({
    configPath: path.join(directory, 'auth.json'),
    onWarning: () => undefined,
  });
  const events: Harness['events'] = [];
  const daemon = new Daemon({
    auth,
    audit: new AuditLogger({ sink: (event: StoredAuditEvent) => events.push(event) }),
    ...options,
  });
  daemons.push(daemon);
  return { daemon, port: await daemon.start(0), auth, events };
}

type WsReply = { type: string; proof?: string; error?: { code: string; message: string } };

async function authenticate(
  port: number,
  token: string,
  nonce?: string,
): Promise<{ socket: WebSocket; reply: WsReply }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(socket);
  const reply = await new Promise<WsReply>((resolve, reject) => {
    socket.on('error', reject);
    socket.on('open', () =>
      socket.send(
        JSON.stringify({
          type: 'auth',
          payload: { token, ...(nonce === undefined ? {} : { nonce }) },
        }),
      ),
    );
    socket.on('message', (data) => resolve(JSON.parse(data.toString()) as WsReply));
  });
  return { socket, reply };
}

function post(port: number, token: string, endpoint: string, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('extension WebSocket credential', () => {
  it('rejects the agent token with a clear error and an audit event', async () => {
    const { daemon, port, auth, events } = await start();
    const { reply } = await authenticate(port, auth.ensureToken());

    expect(reply.type).toBe('error');
    expect(reply.error?.code).toBe('AUTHENTICATION_FAILED');
    expect(reply.error?.message).toMatch(/agent token/iu);
    expect(daemon.isExtensionConnected()).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'extension.authentication',
        outcome: 'denied',
        details: { reason: 'agent-token-presented' },
      }),
    );
  });

  it('does not leak either credential in the error reply', async () => {
    const { port, auth } = await start();
    const { reply } = await authenticate(port, auth.ensureToken());
    expect(JSON.stringify(reply)).not.toContain(auth.ensureToken());
    expect(JSON.stringify(reply)).not.toContain(auth.ensureExtensionCredential());
  });

  it('accepts the extension credential and keeps a bare auth_success without a nonce', async () => {
    const { daemon, port, auth } = await start();
    const { reply } = await authenticate(port, auth.ensureExtensionCredential());

    expect(reply).toEqual({ type: 'auth_success' });
    expect(daemon.isExtensionConnected()).toBe(true);
  });

  it('proves daemon knowledge of the credential with an HMAC when a nonce is supplied', async () => {
    const { port, auth } = await start();
    const credential = auth.ensureExtensionCredential();
    const nonce = crypto.randomBytes(16).toString('hex');
    const { reply } = await authenticate(port, credential, nonce);

    const expected = crypto
      .createHmac('sha256', credential)
      .update(`conduit.daemon-proof.v1:${nonce}`)
      .digest('hex');
    expect(reply.type).toBe('auth_success');
    expect(reply.proof).toBe(expected);
    expect(reply.proof).toBe(computeDaemonProof(credential, nonce));
  });

  it('cannot be displaced by an agent holding only the agent token', async () => {
    const { daemon, port, auth } = await start();
    const real = await authenticate(port, auth.ensureExtensionCredential());
    expect(real.reply.type).toBe('auth_success');
    let realClosed = false;
    real.socket.on('close', () => {
      realClosed = true;
    });

    const intruder = await authenticate(port, auth.ensureToken());
    expect(intruder.reply.type).toBe('error');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(realClosed).toBe(false);
    expect(daemon.isExtensionConnected()).toBe(true);
  });

  it('rejects a malformed nonce at the protocol boundary', async () => {
    const { daemon, port, auth } = await start();
    const { reply } = await authenticate(port, auth.ensureExtensionCredential(), 'short');
    expect(reply.type).toBe('error');
    expect(daemon.isExtensionConnected()).toBe(false);
  });
});

describe('credential hand-out', () => {
  it('local extension pairing returns only the extension credential', async () => {
    const { port, auth } = await start();
    const started = await post(port, auth.ensureToken(), '/api/extension/pairings/start', {});
    const { code } = (await started.json()) as { code: string };
    const response = await fetch(`http://127.0.0.1:${port}/api/extension/pair`, {
      method: 'POST',
      headers: {
        Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ token: auth.ensureExtensionCredential() });
    expect(text).not.toContain(auth.ensureToken());
  });
});

describe('approval authority', () => {
  const askPolicy = (): SecurityPolicy =>
    new SecurityPolicy({ permissions: ['browser.navigate'], domainMode: 'ask' });

  async function pendingConfirmation(harness: Harness): Promise<string> {
    const response = await post(harness.port, harness.auth.ensureToken(), '/api/action', {
      ...createEnvelopeBase(),
      type: 'browser.navigate',
      payload: { url: 'https://example.com' },
    });
    const body = (await response.json()) as ResponseEnvelope;
    if (body.success) throw new Error('Expected a confirmation requirement.');
    return (body.error.details?.confirmation as { id: string }).id;
  }

  it('lets the agent token run actions but not approve its own confirmation', async () => {
    const harness = await start({ policy: askPolicy() });
    const id = await pendingConfirmation(harness);

    const attempt = await post(
      harness.port,
      harness.auth.ensureToken(),
      '/api/confirmations/respond',
      {
        confirmationId: id,
        approved: true,
      },
    );
    const body = (await attempt.json()) as { error: { code: string } };
    expect(attempt.status).toBe(403);
    expect(body.error.code).toBe('PERMISSION_DENIED');
    expect(harness.events).toContainEqual(
      expect.objectContaining({
        type: 'client.authorization',
        outcome: 'denied',
        details: { subject: 'confirmation', reason: 'agent-token-cannot-approve' },
      }),
    );

    const list = await fetch(`http://127.0.0.1:${harness.port}/api/confirmations`, {
      headers: { Authorization: `Bearer ${harness.auth.ensureToken()}` },
    });
    const listed = (await list.json()) as { confirmations: Array<{ id: string }> };
    expect(listed.confirmations.map((item) => item.id)).toContain(id);
  });

  it('accepts approval with the extension credential and denial with the agent token', async () => {
    const harness = await start({ policy: askPolicy() });
    const approvedId = await pendingConfirmation(harness);
    const approved = await post(
      harness.port,
      harness.auth.ensureExtensionCredential(),
      '/api/confirmations/respond',
      { confirmationId: approvedId, approved: true },
    );
    expect(approved.status).toBe(200);

    const deniedId = await pendingConfirmation(harness);
    const denied = await post(
      harness.port,
      harness.auth.ensureToken(),
      '/api/confirmations/respond',
      { confirmationId: deniedId, approved: false },
    );
    expect(denied.status).toBe(200);
  });

  it('does not let the extension credential drive the browser or stop the daemon', async () => {
    const harness = await start({ shutdownHandler: () => undefined });
    const credential = harness.auth.ensureExtensionCredential();
    const action = await post(harness.port, credential, '/api/action', {
      ...createEnvelopeBase(),
      type: 'browser.list_tabs',
      payload: {},
    });
    const shutdown = await post(harness.port, credential, '/api/shutdown', {});
    const pairingStart = await post(harness.port, credential, '/api/pairings/start', {});

    expect(action.status).toBe(403);
    expect(shutdown.status).toBe(403);
    expect(pairingStart.status).toBe(403);
  });

  it('keeps pairing approval and device admission out of reach of the agent token', async () => {
    const devices = new TrustedDeviceStore(path.join(directory, 'devices.json'));
    const harness = await start({ remoteEnabled: true, devices });
    const agent = harness.auth.ensureToken();
    const start1 = await post(harness.port, agent, '/api/pairings/start', {});
    const { code } = (await start1.json()) as { code: string };
    const publicKey = crypto
      .generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      .publicKey.export({ format: 'der', type: 'spki' })
      .toString('base64');
    const request = await fetch(`http://127.0.0.1:${harness.port}/api/remote/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        publicKey,
        deviceName: 'Rogue device',
        requestedPermissions: ['browser.read'],
      }),
    });
    const { pairingId } = (await request.json()) as { pairingId: string };

    const attempt = await post(harness.port, agent, '/api/pairings/respond', {
      pairingId,
      approved: true,
      grantedPermissions: ['browser.dangerous'],
    });
    const body = (await attempt.json()) as { error: { code: string } };
    expect(attempt.status).toBe(403);
    expect(body.error.code).toBe('PERMISSION_DENIED');
    expect(devices.list()).toHaveLength(0);

    const approved = await post(
      harness.port,
      harness.auth.ensureExtensionCredential(),
      '/api/pairings/respond',
      { pairingId, approved: true, grantedPermissions: ['browser.read'] },
    );
    expect(approved.status).toBe(201);
    expect(devices.list()).toHaveLength(1);
  });

  it('lets the agent token deny a pairing', async () => {
    const devices = new TrustedDeviceStore(path.join(directory, 'devices.json'));
    const harness = await start({ remoteEnabled: true, devices });
    const agent = harness.auth.ensureToken();
    const { code } = (await (
      await post(harness.port, agent, '/api/pairings/start', {})
    ).json()) as {
      code: string;
    };
    const publicKey = crypto
      .generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      .publicKey.export({ format: 'der', type: 'spki' })
      .toString('base64');
    const request = await fetch(`http://127.0.0.1:${harness.port}/api/remote/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        publicKey,
        deviceName: 'Denied device',
        requestedPermissions: ['browser.read'],
      }),
    });
    const { pairingId } = (await request.json()) as { pairingId: string };
    const denied = await post(harness.port, agent, '/api/pairings/respond', {
      pairingId,
      approved: false,
    });
    expect(denied.status).toBe(200);
    expect(devices.list()).toHaveLength(0);
  });
});
