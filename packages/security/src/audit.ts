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

export function redact<T>(value: T, key = ''): T {
  if (SENSITIVE_KEY.test(key)) return '[redacted]' as T;
  if (typeof value === 'string') return value.replace(TOKEN_VALUE, '[redacted]') as T;
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

  public constructor(options: AuditLoggerOptions = {}) {
    this.filePath = options.filePath ?? path.join(getAppDataDir(), 'audit.jsonl');
    this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
    this.sink = options.sink;
  }

  public log(event: AuditEvent): StoredAuditEvent {
    const stored = redact({ ...event, id: randomUUID(), timestamp: Date.now() });
    this.sink?.(stored);
    if (!this.sink) {
      this.prepareFile();
      fs.appendFileSync(this.filePath, `${JSON.stringify(stored)}\n`, { mode: 0o600 });
    }
    return stored;
  }

  public read(limit = 200): StoredAuditEvent[] {
    if (!fs.existsSync(this.filePath)) return [];
    return fs
      .readFileSync(this.filePath, 'utf8')
      .split(/\r?\n/u)
      .filter(Boolean)
      .slice(-Math.max(0, limit))
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
