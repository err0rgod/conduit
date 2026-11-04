import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getAppDataDir } from './storage';

export * from './audit';
export * from './confirmation';
export * from './local-pairing';
export * from './policy';
export * from './paths';
export * from './pairing';
export * from './rate-limit';
export * from './storage';

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Domain-separation prefix for the daemon-to-extension mutual authentication proof. */
export const DAEMON_PROOF_CONTEXT = 'conduit.daemon-proof.v1:';

/**
 * Computes the proof a daemon returns to an extension that supplied a client nonce:
 * HMAC-SHA256(extensionCredential, "conduit.daemon-proof.v1:" + nonce), hex encoded.
 * Only a party that knows the extension credential can produce it.
 */
export function computeDaemonProof(extensionCredential: string, nonce: string): string {
  return crypto
    .createHmac('sha256', extensionCredential)
    .update(`${DAEMON_PROOF_CONTEXT}${nonce}`)
    .digest('hex');
}

export interface LocalAuthOptions {
  /** Path of the agent/client credential file. Defaults to `<appdata>/auth.json`. */
  configPath?: string;
  /** Path of the extension credential file. Defaults to `extension-auth.json` beside `configPath`. */
  extensionConfigPath?: string;
  /** Receives non-fatal storage warnings. Defaults to writing a line to stderr. */
  onWarning?: (message: string, details?: Record<string, unknown>) => void;
}

const CREDENTIAL_PATTERN = /^[a-f0-9]{64}$/u;

/**
 * Holds two independent local credentials:
 *
 * - the agent token (`auth.json`) used by MCP and CLI clients over HTTP;
 * - the extension credential (`extension-auth.json`) handed only to the browser
 *   extension (via Native Messaging) and used by the human operator for approvals.
 *
 * Keeping them separate means a leaked or prompt-injected agent token cannot impersonate the
 * extension or approve its own confirmations. Both files are readable by the same OS user,
 * so this is defense in depth rather than a boundary against a malicious same-user process.
 */
export class LocalAuth {
  private readonly configPath: string;
  private readonly extensionConfigPath: string;
  private readonly onWarning: NonNullable<LocalAuthOptions['onWarning']>;
  private token: string | null = null;
  private extensionCredential: string | null = null;

  public constructor(options: LocalAuthOptions = {}) {
    this.configPath = options.configPath ?? path.join(getAppDataDir(), 'auth.json');
    this.extensionConfigPath =
      options.extensionConfigPath ??
      path.join(path.dirname(this.configPath), 'extension-auth.json');
    this.onWarning =
      options.onWarning ??
      ((message) => {
        process.stderr.write(`conduit: ${message}\n`);
      });
  }

  public ensureToken(): string {
    if (!this.token) this.token = this.loadOrCreate(this.configPath, 'agent token');
    return this.token;
  }

  public rotateToken(): string {
    this.token = this.create(this.configPath);
    return this.token;
  }

  public verifyToken(token: string): boolean {
    return constantTimeEqual(token, this.ensureToken());
  }

  /** Credential issued only to the browser extension (and to operator-level approvals). */
  public ensureExtensionCredential(): string {
    if (!this.extensionCredential) {
      this.extensionCredential = this.loadOrCreate(
        this.extensionConfigPath,
        'extension credential',
      );
    }
    return this.extensionCredential;
  }

  public rotateExtensionCredential(): string {
    this.extensionCredential = this.create(this.extensionConfigPath);
    return this.extensionCredential;
  }

  public verifyExtensionCredential(credential: string): boolean {
    return constantTimeEqual(credential, this.ensureExtensionCredential());
  }

  public getConfigPath(): string {
    return this.configPath;
  }

  public getExtensionConfigPath(): string {
    return this.extensionConfigPath;
  }

  private loadOrCreate(filePath: string, label: string): string {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { token?: unknown };
        if (typeof data.token === 'string' && CREDENTIAL_PATTERN.test(data.token)) {
          this.restrictPermissions(filePath);
          return data.token;
        }
        this.onWarning(`The stored ${label} was malformed and has been replaced.`, {
          file: path.basename(filePath),
        });
      } catch {
        this.onWarning(`The stored ${label} could not be parsed and has been replaced.`, {
          file: path.basename(filePath),
        });
      }
    }
    return this.create(filePath);
  }

  private create(filePath: string): string {
    const value = generateToken();
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, JSON.stringify({ token: value }, null, 2), { mode: 0o600 });
    this.restrictPermissions(filePath);
    return value;
  }

  private restrictPermissions(filePath: string): void {
    if (process.platform === 'win32') {
      this.restrictWindowsAcl(filePath);
      return;
    }
    try {
      fs.chmodSync(path.dirname(filePath), 0o700);
      fs.chmodSync(filePath, 0o600);
    } catch (error) {
      this.onWarning('Could not restrict credential file permissions.', {
        file: path.basename(filePath),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Best effort: remove inherited ACEs and grant only the current user full control. */
  private restrictWindowsAcl(filePath: string): void {
    const user = process.env.USERNAME;
    if (!user) {
      this.onWarning('Could not restrict credential ACL: USERNAME is not set.', {
        file: path.basename(filePath),
      });
      return;
    }
    const domain = process.env.USERDOMAIN;
    const principal = domain ? `${domain}\\${user}` : user;
    try {
      execFileSync('icacls', [filePath, '/inheritance:r', '/grant:r', `${principal}:F`], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 10_000,
      });
    } catch (error) {
      this.onWarning('Could not restrict credential file ACL to the current user.', {
        file: path.basename(filePath),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function constantTimeEqual(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
