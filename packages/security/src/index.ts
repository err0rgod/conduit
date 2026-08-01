import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getAppDataDir } from './storage';

export * from './audit';
export * from './confirmation';
export * from './policy';
export * from './paths';
export * from './pairing';
export * from './rate-limit';
export * from './storage';

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export interface LocalAuthOptions {
  configPath?: string;
}

export class LocalAuth {
  private readonly configPath: string;
  private token: string | null = null;

  public constructor(options: LocalAuthOptions = {}) {
    this.configPath = options.configPath ?? path.join(getAppDataDir(), 'auth.json');
  }

  public ensureToken(): string {
    if (this.token) return this.token;

    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    if (fs.existsSync(this.configPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) as { token?: unknown };
        if (typeof data.token === 'string' && /^[a-f0-9]{64}$/u.test(data.token)) {
          this.token = data.token;
          this.restrictPermissions();
          return data.token;
        }
      } catch {
        // A malformed local identity is replaced with a fresh cryptographic token below.
      }
    }

    this.token = generateToken();
    fs.writeFileSync(this.configPath, JSON.stringify({ token: this.token }, null, 2), {
      mode: 0o600,
    });
    this.restrictPermissions();
    return this.token;
  }

  public rotateToken(): string {
    this.token = generateToken();
    const dir = path.dirname(this.configPath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.configPath, JSON.stringify({ token: this.token }, null, 2), {
      mode: 0o600,
    });
    this.restrictPermissions();
    return this.token;
  }

  public verifyToken(token: string): boolean {
    const expected = this.ensureToken();
    if (token.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  }

  public getConfigPath(): string {
    return this.configPath;
  }

  private restrictPermissions(): void {
    try {
      fs.chmodSync(path.dirname(this.configPath), 0o700);
      fs.chmodSync(this.configPath, 0o600);
    } catch {
      // Windows ACLs are not represented by POSIX modes; storage remains user-profile scoped.
    }
  }
}
