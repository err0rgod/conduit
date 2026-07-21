import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalAuth, getAppDataDir, generateToken } from '../src/index';
import * as fs from 'fs';
import * as path from 'path';

describe('LocalAuth', () => {
  const testDir = path.join(getAppDataDir(), 'test-auth');
  const testConfigPath = path.join(testDir, 'auth.json');
  let originalConfigPath: string;
  let auth: LocalAuth;

  beforeEach(() => {
    auth = new LocalAuth();
    originalConfigPath = (auth as any).configPath;
    (auth as any).configPath = testConfigPath;
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
    if (fs.existsSync(testDir)) {
      fs.rmdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
    if (fs.existsSync(testDir)) {
      fs.rmdirSync(testDir, { recursive: true });
    }
  });

  it('generates a new token if none exists', () => {
    const token = auth.ensureToken();
    expect(token).toBeTruthy();
    expect(token.length).toBe(64);
    expect(fs.existsSync(testConfigPath)).toBe(true);
  });

  it('reuses the existing token', () => {
    const token1 = auth.ensureToken();
    const auth2 = new LocalAuth();
    (auth2 as any).configPath = testConfigPath;
    const token2 = auth2.ensureToken();
    expect(token1).toBe(token2);
  });

  it('verifies a valid token', () => {
    const token = auth.ensureToken();
    expect(auth.verifyToken(token)).toBe(true);
  });

  it('rejects an invalid token', () => {
    auth.ensureToken();
    expect(auth.verifyToken(generateToken())).toBe(false);
  });
});
