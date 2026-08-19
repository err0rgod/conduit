import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AuditLogger, redact } from '../src/audit';

const temporaryPaths: string[] = [];
afterEach(() => {
  for (const temporaryPath of temporaryPaths.splice(0)) {
    rmSync(temporaryPath, { recursive: true, force: true });
  }
});

describe('audit redaction', () => {
  it('redacts nested secrets, form text, cookies, and bearer-like tokens', () => {
    const value = redact({
      token: 'secret-token',
      nested: { password: 'hunter2', text: 'typed value', safe: 'Bearer ' + 'a'.repeat(64) },
      cookies: [{ value: 'session' }],
    });
    expect(value).toEqual({
      token: '[redacted]',
      nested: { password: '[redacted]', text: '[redacted]', safe: '[redacted]' },
      cookies: '[redacted]',
    });
  });

  it('writes structured JSONL without recording sensitive values', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'conduit-audit-'));
    temporaryPaths.push(directory);
    const filePath = path.join(directory, 'audit.jsonl');
    const logger = new AuditLogger({ filePath });
    logger.log({ type: 'browser.action', outcome: 'success', details: { text: 'private' } });
    const contents = readFileSync(filePath, 'utf8');
    expect(contents).toContain('"text":"[redacted]"');
    expect(contents).not.toContain('private');
    expect(logger.read(1)).toHaveLength(1);
  });

  it('keeps a bounded redacted read view when an injected sink is used', () => {
    const sinkEvents: unknown[] = [];
    const logger = new AuditLogger({ sink: (event) => sinkEvents.push(event) });
    logger.log({ type: 'first', outcome: 'success' });
    logger.log({ type: 'second', outcome: 'denied', details: { token: 'never expose me' } });

    expect(sinkEvents).toHaveLength(2);
    expect(logger.read(1)).toEqual([
      expect.objectContaining({
        type: 'second',
        details: { token: '[redacted]' },
      }),
    ]);
    expect(logger.read(Number.POSITIVE_INFINITY)).toEqual([]);
  });
});
