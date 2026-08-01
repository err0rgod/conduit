import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileAccessError, validateUploadPaths } from '../src/paths';

const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })),
);

describe('upload path validation', () => {
  it('normalizes allowed files and rejects traversal outside the allowlist', () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'conduit-upload-'));
    directories.push(parent);
    const allowed = path.join(parent, 'allowed');
    const outside = path.join(parent, 'outside.txt');
    mkdirSync(allowed);
    writeFileSync(path.join(allowed, 'inside.txt'), 'ok');
    writeFileSync(outside, 'no');
    expect(validateUploadPaths([path.join(allowed, '.', 'inside.txt')], [allowed])).toEqual([
      realpathSync(path.join(allowed, 'inside.txt')),
    ]);
    expect(() => validateUploadPaths([path.join(allowed, '..', 'outside.txt')], [allowed])).toThrow(
      FileAccessError,
    );
  });

  it('rejects oversized files and an empty allowlist', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'conduit-upload-'));
    directories.push(directory);
    const file = path.join(directory, 'large.txt');
    writeFileSync(file, '12345');
    expect(() => validateUploadPaths([file], [], 10)).toThrow('allowlist is empty');
    expect(() => validateUploadPaths([file], [directory], 4)).toThrow('size limit');
  });
});
