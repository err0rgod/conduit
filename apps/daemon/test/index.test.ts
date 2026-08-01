import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Daemon } from '../src/index';
import {
  PROTOCOL_VERSION,
  ResponseEnvelope,
  createEnvelopeBase,
  createSuccessResponse,
} from '@conduit/protocol';
import WebSocket from 'ws';
import {
  AuditLogger,
  SecurityPolicy,
  TrustedDeviceStore,
  createRemoteSignaturePayload,
  digestRemoteRequest,
} from '@conduit/security';

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

describe('Daemon authorization', () => {
  it('denies ungranted browser permissions before forwarding', async () => {
    const events: Array<{ type: string; outcome: string }> = [];
    const secured = new Daemon({
      policy: new SecurityPolicy({ permissions: ['browser.read'] }),
      audit: new AuditLogger({ sink: (event) => events.push(event) }),
    });
    const securedPort = await secured.start(0);
    try {
      const response = await fetch(`http://127.0.0.1:${securedPort}/api/action`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secured.getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...createEnvelopeBase(),
          type: 'browser.click',
          payload: { target: { elementId: 'e1' } },
        }),
      });
      const body = (await response.json()) as ResponseEnvelope;
      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'permission.decision', outcome: 'denied' }),
      );
    } finally {
      await secured.stop();
    }
  });

  it('requires, approves, and consumes a one-time domain confirmation', async () => {
    const secured = new Daemon({
      policy: new SecurityPolicy({ permissions: ['browser.navigate'], domainMode: 'ask' }),
      audit: new AuditLogger({ sink: () => undefined }),
    });
    const securedPort = await secured.start(0);
    const token = secured.getToken();
    const action = {
      ...createEnvelopeBase(),
      type: 'browser.navigate',
      payload: { url: 'https://example.com' },
    };
    try {
      const pending = await fetch(`http://127.0.0.1:${securedPort}/api/action`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      });
      const pendingBody = (await pending.json()) as ResponseEnvelope;
      expect(pending.status).toBe(409);
      if (pendingBody.success) throw new Error('Expected a confirmation response.');
      const confirmation = pendingBody.error.details?.confirmation as { id: string };

      const approval = await fetch(`http://127.0.0.1:${securedPort}/api/confirmations/respond`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmationId: confirmation.id, approved: true }),
      });
      expect(approval.status).toBe(200);

      const approvedAction = await fetch(`http://127.0.0.1:${securedPort}/api/action`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Conduit-Confirmation': confirmation.id,
        },
        body: JSON.stringify(action),
      });
      const approvedBody = (await approvedAction.json()) as ResponseEnvelope;
      expect(approvedAction.status).toBe(503);
      expect(approvedBody.success).toBe(false);
      if (!approvedBody.success) expect(approvedBody.error.code).toBe('EXTENSION_DISCONNECTED');

      const reused = await fetch(`http://127.0.0.1:${securedPort}/api/action`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Conduit-Confirmation': confirmation.id,
        },
        body: JSON.stringify(action),
      });
      expect(reused.status).toBe(409);
    } finally {
      await secured.stop();
    }
  });
});

describe('Daemon transport hardening', () => {
  it('rejects deterministic startup when the configured port is unavailable', async () => {
    const first = new Daemon();
    const occupiedPort = await first.start(0);
    const second = new Daemon({ audit: new AuditLogger({ sink: () => undefined }) });
    try {
      await expect(second.start(occupiedPort)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await first.stop();
      await second.stop();
    }
  });

  it('closes extension connections that do not authenticate in time', async () => {
    const hardened = new Daemon({ authenticationTimeoutMs: 25 });
    const hardenedPort = await hardened.start(0);
    const ws = new WebSocket(`ws://127.0.0.1:${hardenedPort}`);
    try {
      const closeCode = await new Promise<number>((resolve) => {
        ws.on('close', (code) => resolve(code));
      });
      expect(closeCode).toBe(4001);
    } finally {
      await hardened.stop();
    }
  });

  it('throttles repeated failed HTTP authentication attempts', async () => {
    const hardened = new Daemon({
      maximumAuthenticationFailures: 1,
      authenticationFailureWindowMs: 10_000,
    });
    const hardenedPort = await hardened.start(0);
    try {
      const request = () =>
        fetch(`http://127.0.0.1:${hardenedPort}/api/confirmations`, {
          headers: { Authorization: 'Bearer invalid' },
        });
      expect((await request()).status).toBe(401);
      const limited = await request();
      const body = (await limited.json()) as ResponseEnvelope;
      expect(limited.status).toBe(429);
      expect(body.success).toBe(false);
      if (!body.success) expect(body.error.code).toBe('RATE_LIMITED');
    } finally {
      await hardened.stop();
    }
  });

  it('bounds the action queue and rejects recently reused request IDs', async () => {
    const hardened = new Daemon({ maximumPendingRequests: 1, requestTimeoutMs: 1_000 });
    const hardenedPort = await hardened.start(0);
    const ws = await connectExtension(hardenedPort, hardened.getToken());
    const firstAction = { ...createEnvelopeBase(), type: 'browser.list_tabs' };
    try {
      const extensionRequestPromise = onceExtensionRequest(ws, 'browser.list_tabs');
      const firstFetch = postAction(hardenedPort, hardened.getToken(), firstAction);
      const extensionRequest = await extensionRequestPromise;

      const queueFull = await postAction(hardenedPort, hardened.getToken(), {
        ...createEnvelopeBase(),
        type: 'browser.list_tabs',
      });
      expect(queueFull.status).toBe(429);

      ws.send(JSON.stringify(createSuccessResponse({ tabs: [] }, extensionRequest.id)));
      expect((await firstFetch).status).toBe(200);

      const duplicate = await postAction(hardenedPort, hardened.getToken(), firstAction);
      const duplicateBody = (await duplicate.json()) as ResponseEnvelope;
      expect(duplicate.status).toBe(409);
      expect(duplicateBody.success).toBe(false);
      if (!duplicateBody.success) expect(duplicateBody.error.code).toBe('INVALID_REQUEST');
    } finally {
      ws.close();
      await hardened.stop();
    }
  });

  it('expires authenticated extension sessions', async () => {
    const hardened = new Daemon({ heartbeatIntervalMs: 10, sessionTimeoutMs: 30 });
    const hardenedPort = await hardened.start(0);
    const ws = await connectExtension(hardenedPort, hardened.getToken());
    try {
      const closeCode = await new Promise<number>((resolve) => {
        ws.on('close', (code) => resolve(code));
      });
      expect(closeCode).toBe(4003);
      expect(hardened.isExtensionConnected()).toBe(false);
    } finally {
      await hardened.stop();
    }
  });

  it('returns a structured error to in-flight actions during shutdown', async () => {
    const hardened = new Daemon({ requestTimeoutMs: 5_000 });
    const hardenedPort = await hardened.start(0);
    const ws = await connectExtension(hardenedPort, hardened.getToken());
    const extensionRequestPromise = onceExtensionRequest(ws, 'browser.list_tabs');
    const responsePromise = postAction(hardenedPort, hardened.getToken(), {
      ...createEnvelopeBase(),
      type: 'browser.list_tabs',
    });
    await extensionRequestPromise;
    await hardened.stop();
    const response = await responsePromise;
    const body = (await response.json()) as ResponseEnvelope;
    expect(response.status).toBe(502);
    expect(body.success).toBe(false);
    if (!body.success) expect(body.error.code).toBe('DAEMON_UNAVAILABLE');
  });
});

describe('Daemon remote devices', () => {
  it('keeps remote mode disabled and rejects unsafe public binding by default', async () => {
    const localOnly = new Daemon({ maximumRemoteRequests: 1, remoteRequestWindowMs: 10_000 });
    const localPort = await localOnly.start(0);
    try {
      const response = await fetch(`http://127.0.0.1:${localPort}/api/remote/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(403);
      const limited = await fetch(`http://127.0.0.1:${localPort}/api/remote/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(limited.status).toBe(429);
    } finally {
      await localOnly.stop();
    }

    const unsafe = new Daemon({ bindAddress: '0.0.0.0', remoteEnabled: true });
    await expect(unsafe.start(0)).rejects.toThrowError(
      'Non-loopback binding requires explicit remote mode and TLS configuration.',
    );
  });

  it('pairs, authenticates, constrains, and revokes a remote device', async () => {
    const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-remote-daemon-'));
    const devices = new TrustedDeviceStore(path.join(testDirectory, 'devices.json'));
    const remoteDaemon = new Daemon({
      remoteEnabled: true,
      devices,
      audit: new AuditLogger({ sink: () => undefined }),
    });
    const remotePort = await remoteDaemon.start(0);
    const localToken = remoteDaemon.getToken();
    const identity = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKey = identity.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    let ws: WebSocket | undefined;
    try {
      const start = await daemonRequest(remotePort, localToken, '/api/pairings/start', {});
      expect(start.status).toBe(201);
      const { code } = (await start.json()) as { code: string };

      const pairing = await fetch(`http://127.0.0.1:${remotePort}/api/remote/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          publicKey,
          deviceName: 'Remote test laptop',
          requestedPermissions: ['browser.read'],
        }),
      });
      expect(pairing.status).toBe(202);
      const pending = (await pairing.json()) as { pairingId: string; fingerprint: string };

      const reusedCode = await fetch(`http://127.0.0.1:${remotePort}/api/remote/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          publicKey,
          deviceName: 'Replay',
          requestedPermissions: ['browser.read'],
        }),
      });
      expect(reusedCode.status).toBe(410);

      const approval = await daemonRequest(remotePort, localToken, '/api/pairings/respond', {
        pairingId: pending.pairingId,
        approved: true,
        grantedPermissions: ['browser.read'],
      });
      expect(approval.status).toBe(201);
      const approvalBody = (await approval.json()) as { device: { id: string } };
      const deviceId = approvalBody.device.id;

      const requestDigest = digestRemoteRequest({
        deviceId,
        purpose: 'conduit.remote.session.v1',
      });
      const challengeResponse = await fetch(`http://127.0.0.1:${remotePort}/api/remote/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, requestDigest }),
      });
      expect(challengeResponse.status).toBe(201);
      const challenge = (await challengeResponse.json()) as {
        challengeId: string;
        nonce: string;
      };
      const signature = crypto
        .sign(
          'sha256',
          Buffer.from(
            createRemoteSignaturePayload(challenge.challengeId, challenge.nonce, requestDigest),
          ),
          identity.privateKey,
        )
        .toString('base64');
      const authentication = await fetch(`http://127.0.0.1:${remotePort}/api/remote/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          challengeId: challenge.challengeId,
          requestDigest,
          signature,
        }),
      });
      expect(authentication.status).toBe(200);
      const remoteSession = (await authentication.json()) as { token: string };

      ws = await connectExtension(remotePort, localToken);
      const extensionRequestPromise = onceExtensionRequest(ws, 'browser.list_tabs');
      const remoteActionPromise = postAction(remotePort, remoteSession.token, {
        ...createEnvelopeBase(),
        type: 'browser.list_tabs',
      });
      const extensionRequest = await extensionRequestPromise;
      ws.send(JSON.stringify(createSuccessResponse({ tabs: [] }, extensionRequest.id)));
      expect((await remoteActionPromise).status).toBe(200);

      const ungranted = await postAction(remotePort, remoteSession.token, {
        ...createEnvelopeBase(),
        type: 'browser.navigate',
        payload: { url: 'https://example.com' },
      });
      expect(ungranted.status).toBe(403);

      const revocation = await daemonRequest(remotePort, localToken, '/api/devices/revoke', {
        deviceId,
      });
      expect(revocation.status).toBe(200);
      const revokedSession = await postAction(remotePort, remoteSession.token, {
        ...createEnvelopeBase(),
        type: 'browser.list_tabs',
      });
      expect(revokedSession.status).toBe(401);
    } finally {
      ws?.close();
      await remoteDaemon.stop();
      fs.rmSync(testDirectory, { recursive: true, force: true });
    }
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

function postAction(port: number, token: string, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/action`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function daemonRequest(
  port: number,
  token: string,
  endpoint: string,
  body: unknown,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
