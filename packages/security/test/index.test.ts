import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { LocalAuth, computeDaemonProof, generateToken } from '../src/index';

describe('LocalAuth', () => {
  let testDir: string;
  let testConfigPath: string;
  let auth: LocalAuth;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-auth-'));
    testConfigPath = path.join(testDir, 'auth.json');
    auth = new LocalAuth({ configPath: testConfigPath });
  });

  afterEach(() => fs.rmSync(testDir, { recursive: true, force: true }));

  it('generates and reuses a persisted 256-bit token', () => {
    const token = auth.ensureToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/u);
    expect(new LocalAuth({ configPath: testConfigPath }).ensureToken()).toBe(token);
  });

  it('verifies valid tokens with constant-length comparison and rejects invalid ones', () => {
    const token = auth.ensureToken();
    expect(auth.verifyToken(token)).toBe(true);
    expect(auth.verifyToken(generateToken())).toBe(false);
    expect(auth.verifyToken('short')).toBe(false);
  });

  it('replaces malformed stored authentication state', () => {
    fs.writeFileSync(testConfigPath, JSON.stringify({ token: 42 }));
    const quiet = new LocalAuth({ configPath: testConfigPath, onWarning: () => undefined });
    expect(quiet.ensureToken()).toMatch(/^[a-f0-9]{64}$/u);
  });

  describe('extension credential', () => {
    const warnings: string[] = [];
    let separate: LocalAuth;

    beforeEach(() => {
      warnings.length = 0;
      separate = new LocalAuth({
        configPath: testConfigPath,
        onWarning: (message) => warnings.push(message),
      });
    });

    it('stores a distinct persisted credential in its own file', () => {
      const token = separate.ensureToken();
      const credential = separate.ensureExtensionCredential();
      expect(credential).toMatch(/^[a-f0-9]{64}$/u);
      expect(credential).not.toBe(token);
      expect(separate.getExtensionConfigPath()).toBe(path.join(testDir, 'extension-auth.json'));
      const fresh = new LocalAuth({ configPath: testConfigPath });
      expect(fresh.ensureExtensionCredential()).toBe(credential);
      expect(fresh.ensureToken()).toBe(token);
    });

    it('keeps the credentials non-interchangeable', () => {
      const token = separate.ensureToken();
      const credential = separate.ensureExtensionCredential();
      expect(separate.verifyToken(credential)).toBe(false);
      expect(separate.verifyExtensionCredential(token)).toBe(false);
      expect(separate.verifyExtensionCredential(credential)).toBe(true);
      expect(separate.verifyExtensionCredential('short')).toBe(false);
    });

    it('rotating the extension credential leaves the agent token intact', () => {
      const token = separate.ensureToken();
      const original = separate.ensureExtensionCredential();
      const rotated = separate.rotateExtensionCredential();
      expect(rotated).not.toBe(original);
      expect(separate.verifyExtensionCredential(original)).toBe(false);
      expect(separate.verifyToken(token)).toBe(true);
    });

    it('migrates an install that only has auth.json without changing the agent token', () => {
      fs.writeFileSync(testConfigPath, JSON.stringify({ token: 'c'.repeat(64) }));
      expect(separate.ensureToken()).toBe('c'.repeat(64));
      expect(separate.ensureExtensionCredential()).not.toBe('c'.repeat(64));
      expect(warnings).toEqual([]);
    });

    it('warns instead of silently replacing malformed credential files', () => {
      fs.writeFileSync(testConfigPath, '{not json');
      fs.writeFileSync(path.join(testDir, 'extension-auth.json'), JSON.stringify({ token: 7 }));
      separate.ensureToken();
      separate.ensureExtensionCredential();
      expect(warnings).toHaveLength(2);
      expect(warnings.join(' ')).not.toMatch(/[a-f0-9]{64}/u);
    });

    it('computes the daemon proof as domain-separated HMAC-SHA256', () => {
      const credential = separate.ensureExtensionCredential();
      const nonce = 'n'.repeat(24);
      const expected = crypto
        .createHmac('sha256', credential)
        .update(`conduit.daemon-proof.v1:${nonce}`)
        .digest('hex');
      expect(computeDaemonProof(credential, nonce)).toBe(expected);
      expect(computeDaemonProof(credential, 'm'.repeat(24))).not.toBe(expected);
    });

    it.runIf(process.platform !== 'win32')('writes credential files with mode 0600', () => {
      separate.ensureExtensionCredential();
      expect(fs.statSync(separate.getExtensionConfigPath()).mode & 0o777).toBe(0o600);
    });
  });

  it('rotates the token and invalidates the prior value', () => {
    const original = auth.ensureToken();
    const rotated = auth.rotateToken();
    expect(rotated).not.toBe(original);
    expect(auth.verifyToken(original)).toBe(false);
    expect(auth.verifyToken(rotated)).toBe(true);
  });
});
