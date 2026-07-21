import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export function getAppDataDir(): string {
  const platform = os.platform();
  const homedir = os.homedir();
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming'), 'Conduit');
  }
  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support', 'Conduit');
  }
  return path.join(homedir, '.config', 'conduit');
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export class LocalAuth {
  private configPath: string;
  private token: string | null = null;

  constructor() {
    this.configPath = path.join(getAppDataDir(), 'auth.json');
  }

  public ensureToken(): string {
    if (this.token) return this.token;

    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    if (fs.existsSync(this.configPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        if (data.token) {
          this.token = data.token;
          return data.token;
        }
      } catch (e) {
        // Ignore and generate new
      }
    }

    this.token = generateToken();
    fs.writeFileSync(this.configPath, JSON.stringify({ token: this.token }, null, 2), {
      mode: 0o600,
    });
    return this.token!;
  }

  public verifyToken(token: string): boolean {
    const expected = this.ensureToken();
    if (token.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  }
}
