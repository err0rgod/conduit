import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AuditLogger } from '../src/audit';

const DAY_SECONDS = 24 * 60 * 60;
const temporaryPaths: string[] = [];

afterEach(() => {
  for (const temporaryPath of temporaryPaths.splice(0)) {
    rmSync(temporaryPath, { recursive: true, force: true });
  }
});

function createDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'conduit-retention-'));
  temporaryPaths.push(directory);
  return directory;
}

function createRotated(directory: string, name: string, ageDays: number): string {
  const filePath = path.join(directory, name);
  writeFileSync(filePath, '{}\n');
  const when = Date.now() / 1000 - ageDays * DAY_SECONDS;
  utimesSync(filePath, when, when);
  return filePath;
}

describe('audit retention', () => {
  it('deletes only rotated files older than retentionDays at startup', () => {
    const directory = createDirectory();
    const active = path.join(directory, 'audit.jsonl');
    writeFileSync(active, '{}\n');
    const old = createRotated(directory, 'audit.jsonl.1700000000000', 45);
    const legacy = createRotated(directory, 'audit.jsonl.1', 45);
    const recent = createRotated(directory, 'audit.jsonl.1800000000000', 2);
    const unrelated = createRotated(directory, 'audit.jsonl.bak', 400);
    const other = createRotated(directory, 'notes.txt', 400);

    new AuditLogger({ filePath: active, retentionDays: 30 });

    expect(existsSync(old)).toBe(false);
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
    expect(existsSync(other)).toBe(true);
    expect(existsSync(active)).toBe(true);
  });

  it('keeps everything when retentionDays is not configured', () => {
    const directory = createDirectory();
    const old = createRotated(directory, 'audit.jsonl.1700000000000', 900);
    new AuditLogger({ filePath: path.join(directory, 'audit.jsonl') });
    expect(existsSync(old)).toBe(true);
  });

  it('rotates into a new file, keeps recent rotations, and prunes expired ones on rotation', () => {
    const directory = createDirectory();
    const active = path.join(directory, 'audit.jsonl');
    const logger = new AuditLogger({ filePath: active, maxBytes: 200, retentionDays: 30 });
    const expired = createRotated(directory, 'audit.jsonl.1', 60);

    for (let index = 0; index < 20; index += 1) {
      logger.log({ type: 'browser.action', outcome: 'success', operation: `op-${index}` });
    }

    const rotated = readdirSync(directory).filter((name) => /^audit\.jsonl\.\d+$/u.test(name));
    expect(existsSync(expired)).toBe(false);
    expect(rotated.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(active)).toBe(true);
  });
});
