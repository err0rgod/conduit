import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { LocalAuth, generateToken } from '../src/index';

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
    expect(auth.ensureToken()).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('rotates the token and invalidates the prior value', () => {
    const original = auth.ensureToken();
    const rotated = auth.rotateToken();
    expect(rotated).not.toBe(original);
    expect(auth.verifyToken(original)).toBe(false);
    expect(auth.verifyToken(rotated)).toBe(true);
  });
});
