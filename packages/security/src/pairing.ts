import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PairingRequest, Permission, PermissionSchema } from '@conduit/protocol';
import { getAppDataDir } from './storage';

const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STORE_VERSION = 1;

export interface TrustedDevice {
  id: string;
  name: string;
  publicKey: string;
  fingerprint: string;
  permissions: Permission[];
  createdAt: number;
  lastAuthenticatedAt?: number;
  revokedAt?: number;
}

interface TrustedDeviceState {
  version: typeof STORE_VERSION;
  devices: TrustedDevice[];
}

export interface PendingPairing {
  id: string;
  deviceName: string;
  publicKey: string;
  fingerprint: string;
  requestedPermissions: Permission[];
  requestedAt: number;
  expiresAt: number;
}

interface PairingCodeState {
  expiresAt: number;
}

interface ChallengeState {
  deviceId: string;
  nonce: string;
  requestDigest: string;
  expiresAt: number;
}

export class PairingError extends Error {
  public constructor(
    public readonly code:
      'PAIRING_CODE_EXPIRED' | 'INVALID_REQUEST' | 'AUTHENTICATION_FAILED' | 'DEVICE_REVOKED',
    message: string,
  ) {
    super(message);
    this.name = 'PairingError';
  }
}

export class TrustedDeviceStore {
  private readonly storagePath: string;

  public constructor(storagePath = path.join(getAppDataDir(), 'trusted-devices.json')) {
    this.storagePath = storagePath;
  }

  public list(): TrustedDevice[] {
    return this.read().devices.map(copyDevice);
  }

  public get(deviceId: string): TrustedDevice | undefined {
    const device = this.read().devices.find((candidate) => candidate.id === deviceId);
    return device ? copyDevice(device) : undefined;
  }

  public add(input: Omit<TrustedDevice, 'id' | 'createdAt'>): TrustedDevice {
    const state = this.read();
    const existing = state.devices.find(
      (device) => device.fingerprint === input.fingerprint && device.revokedAt === undefined,
    );
    if (existing) throw new PairingError('INVALID_REQUEST', 'This device is already trusted.');
    const device: TrustedDevice = {
      ...input,
      permissions: uniquePermissions(input.permissions),
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    state.devices.push(device);
    this.write(state);
    return copyDevice(device);
  }

  public revoke(deviceId: string, now = Date.now()): boolean {
    const state = this.read();
    const device = state.devices.find((candidate) => candidate.id === deviceId);
    if (!device || device.revokedAt !== undefined) return false;
    device.revokedAt = now;
    this.write(state);
    return true;
  }

  public revokeAll(now = Date.now()): number {
    const state = this.read();
    let revoked = 0;
    for (const device of state.devices) {
      if (device.revokedAt === undefined) {
        device.revokedAt = now;
        revoked += 1;
      }
    }
    if (revoked > 0) this.write(state);
    return revoked;
  }

  public markAuthenticated(deviceId: string, now = Date.now()): void {
    const state = this.read();
    const device = state.devices.find((candidate) => candidate.id === deviceId);
    if (!device || device.revokedAt !== undefined) return;
    device.lastAuthenticatedAt = now;
    this.write(state);
  }

  public getStoragePath(): string {
    return this.storagePath;
  }

  private read(): TrustedDeviceState {
    if (!fs.existsSync(this.storagePath)) return { version: STORE_VERSION, devices: [] };
    let value: unknown;
    try {
      value = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
    } catch {
      throw new PairingError('INVALID_REQUEST', 'Trusted-device storage is malformed.');
    }
    if (!isTrustedDeviceState(value)) {
      throw new PairingError('INVALID_REQUEST', 'Trusted-device storage failed validation.');
    }
    return value;
  }

  private write(state: TrustedDeviceState): void {
    const directory = path.dirname(this.storagePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.storagePath, JSON.stringify(state, null, 2), { mode: 0o600 });
    try {
      fs.chmodSync(directory, 0o700);
      fs.chmodSync(this.storagePath, 0o600);
    } catch {
      // Windows protects this user-profile location through ACLs instead of POSIX modes.
    }
  }
}

export class PairingManager {
  private readonly pairingCodes = new Map<string, PairingCodeState>();
  private readonly pendingPairings = new Map<string, PendingPairing>();

  public constructor(
    private readonly devices: TrustedDeviceStore,
    private readonly codeTtlMs = 5 * 60_000,
    private readonly approvalTtlMs = 5 * 60_000,
  ) {}

  public createCode(now = Date.now()): { code: string; expiresAt: number } {
    this.prune(now);
    let code: string;
    do code = randomPairingCode();
    while (this.pairingCodes.has(hashPairingCode(code)));
    const expiresAt = now + this.codeTtlMs;
    this.pairingCodes.set(hashPairingCode(code), { expiresAt });
    return { code, expiresAt };
  }

  public submit(request: PairingRequest, now = Date.now()): PendingPairing {
    this.prune(now);
    const codeHash = hashPairingCode(request.code);
    const pairingCode = this.pairingCodes.get(codeHash);
    if (!pairingCode || pairingCode.expiresAt <= now) {
      this.pairingCodes.delete(codeHash);
      throw new PairingError('PAIRING_CODE_EXPIRED', 'Pairing code is invalid, expired, or used.');
    }
    const publicKey = parseP256PublicKey(request.publicKey);
    const fingerprint = fingerprintPublicKey(publicKey);
    if (
      this.devices
        .list()
        .some((device) => device.fingerprint === fingerprint && device.revokedAt === undefined)
    ) {
      throw new PairingError('INVALID_REQUEST', 'This device is already trusted.');
    }
    this.pairingCodes.delete(codeHash);
    const pairing: PendingPairing = {
      id: crypto.randomUUID(),
      deviceName: request.deviceName,
      publicKey: request.publicKey,
      fingerprint,
      requestedPermissions: uniquePermissions(request.requestedPermissions),
      requestedAt: now,
      expiresAt: now + this.approvalTtlMs,
    };
    this.pendingPairings.set(pairing.id, pairing);
    return copyPendingPairing(pairing);
  }

  public listPending(now = Date.now()): PendingPairing[] {
    this.prune(now);
    return [...this.pendingPairings.values()].map(copyPendingPairing);
  }

  public approve(
    pairingId: string,
    grantedPermissions: Permission[],
    now = Date.now(),
  ): TrustedDevice {
    this.prune(now);
    const pairing = this.pendingPairings.get(pairingId);
    if (!pairing) throw new PairingError('PAIRING_CODE_EXPIRED', 'Pairing approval has expired.');
    const requested = new Set(pairing.requestedPermissions);
    const grants = uniquePermissions(grantedPermissions);
    if (grants.some((permission) => !requested.has(permission))) {
      throw new PairingError(
        'INVALID_REQUEST',
        'Granted permissions must be a subset of those requested by the device.',
      );
    }
    const device = this.devices.add({
      name: pairing.deviceName,
      publicKey: pairing.publicKey,
      fingerprint: pairing.fingerprint,
      permissions: grants,
    });
    this.pendingPairings.delete(pairingId);
    return device;
  }

  public deny(pairingId: string): boolean {
    return this.pendingPairings.delete(pairingId);
  }

  private prune(now: number): void {
    for (const [code, state] of this.pairingCodes) {
      if (state.expiresAt <= now) this.pairingCodes.delete(code);
    }
    for (const [id, pairing] of this.pendingPairings) {
      if (pairing.expiresAt <= now) this.pendingPairings.delete(id);
    }
  }
}

export class RemoteDeviceAuthenticator {
  private readonly challenges = new Map<string, ChallengeState>();

  public constructor(
    private readonly devices: TrustedDeviceStore,
    private readonly challengeTtlMs = 30_000,
  ) {}

  public createChallenge(
    deviceId: string,
    requestDigest: string,
    now = Date.now(),
  ): { challengeId: string; nonce: string; expiresAt: number } {
    this.prune(now);
    if (!/^[a-f0-9]{64}$/u.test(requestDigest)) {
      throw new PairingError('INVALID_REQUEST', 'Remote request digest is invalid.');
    }
    this.requireActiveDevice(deviceId);
    const challengeId = crypto.randomUUID();
    const challenge: ChallengeState = {
      deviceId,
      nonce: crypto.randomBytes(32).toString('base64url'),
      requestDigest,
      expiresAt: now + this.challengeTtlMs,
    };
    this.challenges.set(challengeId, challenge);
    return { challengeId, nonce: challenge.nonce, expiresAt: challenge.expiresAt };
  }

  public verify(
    deviceId: string,
    challengeId: string,
    requestDigest: string,
    signature: string,
    now = Date.now(),
  ): TrustedDevice {
    const device = this.requireActiveDevice(deviceId);
    const challenge = this.challenges.get(challengeId);
    this.challenges.delete(challengeId);
    if (!challenge || challenge.expiresAt <= now) {
      throw new PairingError('AUTHENTICATION_FAILED', 'Remote challenge is invalid or expired.');
    }
    if (challenge.deviceId !== deviceId || challenge.requestDigest !== requestDigest) {
      throw new PairingError(
        'AUTHENTICATION_FAILED',
        'Remote challenge does not match the request.',
      );
    }
    const verified = crypto.verify(
      'sha256',
      Buffer.from(createRemoteSignaturePayload(challengeId, challenge.nonce, requestDigest)),
      parseP256PublicKey(device.publicKey),
      Buffer.from(signature, 'base64'),
    );
    if (!verified) throw new PairingError('AUTHENTICATION_FAILED', 'Device signature is invalid.');
    this.devices.markAuthenticated(deviceId, now);
    return this.devices.get(deviceId) ?? device;
  }

  private requireActiveDevice(deviceId: string): TrustedDevice {
    const device = this.devices.get(deviceId);
    if (!device) throw new PairingError('AUTHENTICATION_FAILED', 'Device authentication failed.');
    if (device.revokedAt !== undefined) {
      throw new PairingError('DEVICE_REVOKED', 'This trusted device has been revoked.');
    }
    return device;
  }

  private prune(now: number): void {
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt <= now) this.challenges.delete(id);
    }
  }
}

export function digestRemoteRequest(value: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function createRemoteSignaturePayload(
  challengeId: string,
  nonce: string,
  requestDigest: string,
): string {
  return `conduit.remote.v1\n${challengeId}\n${nonce}\n${requestDigest}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new PairingError('INVALID_REQUEST', 'Remote request cannot be canonicalized.');
}

function randomPairingCode(): string {
  return Array.from(
    { length: 8 },
    () => PAIRING_ALPHABET[crypto.randomInt(PAIRING_ALPHABET.length)],
  ).join('');
}

function hashPairingCode(code: string): string {
  return crypto.createHash('sha256').update(`conduit.pair.v1:${code}`).digest('hex');
}

function parseP256PublicKey(publicKey: string): crypto.KeyObject {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new Error('Unexpected key algorithm.');
    }
    return key;
  } catch {
    throw new PairingError('INVALID_REQUEST', 'Device public key must be a valid P-256 SPKI key.');
  }
}

function fingerprintPublicKey(publicKey: crypto.KeyObject): string {
  const digest = crypto
    .createHash('sha256')
    .update(publicKey.export({ format: 'der', type: 'spki' }))
    .digest('hex')
    .toUpperCase();
  return digest.match(/.{2}/gu)?.join(':') ?? digest;
}

function uniquePermissions(permissions: Permission[]): Permission[] {
  return [...new Set(permissions)];
}

function copyDevice(device: TrustedDevice): TrustedDevice {
  return { ...device, permissions: [...device.permissions] };
}

function copyPendingPairing(pairing: PendingPairing): PendingPairing {
  return { ...pairing, requestedPermissions: [...pairing.requestedPermissions] };
}

function isTrustedDeviceState(value: unknown): value is TrustedDeviceState {
  if (!isRecord(value) || value.version !== STORE_VERSION || !Array.isArray(value.devices)) {
    return false;
  }
  return value.devices.every(
    (device) =>
      isRecord(device) &&
      typeof device.id === 'string' &&
      typeof device.name === 'string' &&
      typeof device.publicKey === 'string' &&
      typeof device.fingerprint === 'string' &&
      Array.isArray(device.permissions) &&
      device.permissions.every((permission) => PermissionSchema.safeParse(permission).success) &&
      typeof device.createdAt === 'number' &&
      (device.lastAuthenticatedAt === undefined ||
        typeof device.lastAuthenticatedAt === 'number') &&
      (device.revokedAt === undefined || typeof device.revokedAt === 'number'),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
