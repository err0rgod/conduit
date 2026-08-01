import * as crypto from 'node:crypto';

const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface LocalPairingCode {
  code: string;
  expiresAt: number;
}

export class LocalPairingManager {
  private readonly codes = new Map<string, number>();

  public constructor(private readonly lifetimeMs = 5 * 60_000) {
    if (lifetimeMs < 1_000) throw new Error('Local pairing lifetime must be at least one second.');
  }

  public create(now = Date.now()): LocalPairingCode {
    this.prune(now);
    const bytes = crypto.randomBytes(12);
    const code = Array.from(
      bytes,
      (value) => PAIRING_ALPHABET[value % PAIRING_ALPHABET.length],
    ).join('');
    const expiresAt = now + this.lifetimeMs;
    this.codes.set(hashCode(code), expiresAt);
    return { code, expiresAt };
  }

  public consume(code: string, now = Date.now()): boolean {
    this.prune(now);
    const digest = hashCode(code);
    const expiresAt = this.codes.get(digest);
    if (expiresAt === undefined) return false;
    this.codes.delete(digest);
    return expiresAt > now;
  }

  private prune(now: number): void {
    for (const [digest, expiresAt] of this.codes) {
      if (expiresAt <= now) this.codes.delete(digest);
    }
  }
}

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(`conduit.extension.pairing.v1:${code}`).digest('hex');
}
