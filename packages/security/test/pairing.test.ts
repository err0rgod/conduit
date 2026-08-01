import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PairingRequest } from '@conduit/protocol';
import {
  PairingError,
  PairingManager,
  RemoteDeviceAuthenticator,
  TrustedDeviceStore,
  createRemoteSignaturePayload,
  digestRemoteRequest,
} from '../src/pairing';

describe('remote device pairing', () => {
  let testDirectory: string;
  let store: TrustedDeviceStore;

  beforeEach(() => {
    testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-pairing-'));
    store = new TrustedDeviceStore(path.join(testDirectory, 'devices.json'));
  });

  afterEach(() => fs.rmSync(testDirectory, { recursive: true, force: true }));

  it('consumes short-lived pairing codes exactly once', () => {
    const manager = new PairingManager(store, 1_000, 1_000);
    const identity = createDeviceIdentity();
    const { code } = manager.createCode(100);
    const request = pairingRequest(code, identity.publicKey);

    const pending = manager.submit(request, 200);
    expect(pending.fingerprint).toMatch(/^([A-F0-9]{2}:){31}[A-F0-9]{2}$/u);
    expect(() => manager.submit(request, 201)).toThrowError(
      expect.objectContaining({ code: 'PAIRING_CODE_EXPIRED' }),
    );

    const expired = manager.createCode(1_000);
    expect(() =>
      manager.submit(pairingRequest(expired.code, identity.publicKey), 2_001),
    ).toThrowError(expect.objectContaining({ code: 'PAIRING_CODE_EXPIRED' }));
  });

  it('requires explicit approval and only grants requested permissions', () => {
    const manager = new PairingManager(store);
    const identity = createDeviceIdentity();
    const { code } = manager.createCode();
    const pending = manager.submit(pairingRequest(code, identity.publicKey));

    expect(() => manager.approve(pending.id, ['browser.dangerous'])).toThrowError(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
    const device = manager.approve(pending.id, ['browser.read']);
    expect(device.permissions).toEqual(['browser.read']);
    expect(new TrustedDeviceStore(store.getStoragePath()).get(device.id)).toEqual(device);
  });

  it('persists revocation and fails closed on malformed storage', () => {
    const device = pairDevice(store);
    expect(store.revoke(device.id, 500)).toBe(true);
    expect(store.revoke(device.id, 501)).toBe(false);
    expect(store.get(device.id)?.revokedAt).toBe(500);

    fs.writeFileSync(store.getStoragePath(), '{malformed');
    expect(() => store.list()).toThrowError(
      expect.objectContaining({ message: 'Trusted-device storage is malformed.' }),
    );
  });

  it('authenticates an exact request with a one-use signed challenge', () => {
    const identity = createDeviceIdentity();
    const device = pairDevice(store, identity.publicKey);
    const authenticator = new RemoteDeviceAuthenticator(store, 1_000);
    const request = { type: 'browser.list_tabs', payload: {}, id: crypto.randomUUID() };
    const requestDigest = digestRemoteRequest(request);
    const challenge = authenticator.createChallenge(device.id, requestDigest, 100);
    const signature = crypto
      .sign(
        'sha256',
        Buffer.from(
          createRemoteSignaturePayload(challenge.challengeId, challenge.nonce, requestDigest),
        ),
        identity.privateKey,
      )
      .toString('base64');

    expect(
      authenticator.verify(device.id, challenge.challengeId, requestDigest, signature, 200).id,
    ).toBe(device.id);
    expect(store.get(device.id)?.lastAuthenticatedAt).toBe(200);
    expect(() =>
      authenticator.verify(device.id, challenge.challengeId, requestDigest, signature, 201),
    ).toThrowError(expect.objectContaining({ code: 'AUTHENTICATION_FAILED' }));
  });

  it('rejects request substitution, expired challenges, and revoked devices', () => {
    const identity = createDeviceIdentity();
    const device = pairDevice(store, identity.publicKey);
    const authenticator = new RemoteDeviceAuthenticator(store, 100);
    const originalDigest = digestRemoteRequest({ action: 'read' });
    const substitutedDigest = digestRemoteRequest({ action: 'click' });
    const challenge = authenticator.createChallenge(device.id, originalDigest, 100);
    const signature = crypto
      .sign(
        'sha256',
        Buffer.from(
          createRemoteSignaturePayload(challenge.challengeId, challenge.nonce, originalDigest),
        ),
        identity.privateKey,
      )
      .toString('base64');

    expect(() =>
      authenticator.verify(device.id, challenge.challengeId, substitutedDigest, signature, 150),
    ).toThrowError(expect.objectContaining({ code: 'AUTHENTICATION_FAILED' }));

    const expired = authenticator.createChallenge(device.id, originalDigest, 200);
    expect(() =>
      authenticator.verify(device.id, expired.challengeId, originalDigest, signature, 301),
    ).toThrowError(expect.objectContaining({ code: 'AUTHENTICATION_FAILED' }));

    store.revoke(device.id);
    expect(() => authenticator.createChallenge(device.id, originalDigest)).toThrowError(
      expect.objectContaining({ code: 'DEVICE_REVOKED' }),
    );
  });
});

function createDeviceIdentity(): {
  publicKey: string;
  privateKey: crypto.KeyObject;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    privateKey,
  };
}

function pairingRequest(code: string, publicKey: string): PairingRequest {
  return {
    code,
    publicKey,
    deviceName: 'Test laptop',
    requestedPermissions: ['browser.read', 'browser.navigate'],
  };
}

function pairDevice(store: TrustedDeviceStore, publicKey = createDeviceIdentity().publicKey) {
  const manager = new PairingManager(store);
  const { code } = manager.createCode();
  const pending = manager.submit(pairingRequest(code, publicKey));
  return manager.approve(pending.id, ['browser.read']);
}
