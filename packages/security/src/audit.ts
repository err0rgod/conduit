import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAppDataDir } from './storage';

export interface AuditEvent {
  type: string;
  outcome: 'success' | 'denied' | 'failure' | 'pending';
  requestId?: string;
  correlationId?: string;
  operation?: string;
  domain?: string;
  details?: Record<string, unknown>;
}

export interface StoredAuditEvent extends AuditEvent {
  id: string;
  timestamp: number;
}

export interface AuditLoggerOptions {
  filePath?: string;
  maxBytes?: number;
  sink?: (event: StoredAuditEvent) => void;
}

const SENSITIVE_KEY =
  /token|password|passwd|secret|authorization|cookie|credential|private.?key|text|value/iu;
const TOKEN_VALUE = /\b(?:bearer\s+)?[a-f0-9]{32,}\b/giu;
// Credentials embedded in URLs: scheme://user:password@host
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]*@/giu;
// Secret-looking query/fragment parameters. The name must be a whole word, optionally
// prefixed with a separator-delimited qualifier (client_secret, x-amz-signature), so
// ordinary parameters such as "keyboard" or "codec" are left alone.
const SECRET_QUERY_PARAMETER =
  /([?&;#](?:[\w.-]*[_-])?(?:token|access_token|refresh_token|id_token|key|api_key|apikey|sig|signature|code|password|passwd|pwd|session|sessionid|sid|auth|secret|credential)=)[^&#\s"'<>]*/giu;
const AUTH_SCHEME_VALUE = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/giu;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*)?/gu;
// Long base64 / base64url runs. Only redacted when they look random (upper, lower and
// digit all present) so long slugs, identifiers and plain paths survive.
const LONG_BASE64 = /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9+/_=-])/gu;

function looksRandom(candidate: string): boolean {
  return /[A-Z]/u.test(candidate) && /[a-z]/u.test(candidate) && /\d/u.test(candidate);
}

export function redactString(value: string): string {
  return value
    .replace(URL_CREDENTIALS, '$1[redacted]@')
    .replace(SECRET_QUERY_PARAMETER, '$1[redacted]')
    .replace(TOKEN_VALUE, '[redacted]')
    .replace(AUTH_SCHEME_VALUE, '$1 [redacted]')
    .replace(JWT, '[redacted]')
    .replace(LONG_BASE64, (match) => (looksRandom(match) ? '[redacted]' : match));
}

export function redact<T>(value: T, key = ''): T {
  if (SENSITIVE_KEY.test(key)) return '[redacted]' as T;
  if (typeof value === 'string') return redactString(value) as T;
  if (Array.isArray(value)) return value.map((item) => redact(item)) as T;
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redact(entryValue, entryKey),
      ]),
    ) as T;
  }
  return value;
}

export class AuditLogger {
  private readonly filePath: string;
  private readonly maxBytes: number;
  private readonly sink?: (event: StoredAuditEvent) => void;
  private readonly recentEvents: StoredAuditEvent[] | undefined;

  public constructor(options: AuditLoggerOptions = {}) {
    this.filePath = options.filePath ?? path.join(getAppDataDir(), 'audit.jsonl');
    this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
    this.sink = options.sink;
    this.recentEvents = options.sink ? [] : undefined;
  }

  public log(event: AuditEvent): StoredAuditEvent {
    const stored = redact({ ...event, id: randomUUID(), timestamp: Date.now() });
    this.sink?.(stored);
    if (this.recentEvents) {
      this.recentEvents.push(stored);
      if (this.recentEvents.length > 1_000) this.recentEvents.shift();
    }
    if (!this.sink) {
      this.prepareFile();
      fs.appendFileSync(this.filePath, `${JSON.stringify(stored)}\n`, { mode: 0o600 });
    }
    return stored;
  }

  public read(limit = 200): StoredAuditEvent[] {
    const boundedLimit = Number.isFinite(limit)
      ? Math.min(1_000, Math.max(0, Math.trunc(limit)))
      : 0;
    if (boundedLimit === 0) return [];
    if (this.recentEvents) return this.recentEvents.slice(-boundedLimit);
    if (!fs.existsSync(this.filePath)) return [];
    return fs
      .readFileSync(this.filePath, 'utf8')
      .split(/\r?\n/u)
      .filter(Boolean)
      .slice(-boundedLimit)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as StoredAuditEvent];
        } catch {
          return [];
        }
      });
  }

  private prepareFile(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(this.filePath) || fs.statSync(this.filePath).size < this.maxBytes) return;
    const rotated = `${this.filePath}.1`;
    if (fs.existsSync(rotated)) fs.rmSync(rotated);
    fs.renameSync(this.filePath, rotated);
  }
}
