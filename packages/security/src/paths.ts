import * as fs from 'node:fs';
import * as path from 'node:path';

export class FileAccessError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'FileAccessError';
  }
}

export function validateUploadPaths(
  files: string[],
  allowlist: string[],
  maxFileBytes = 10 * 1024 * 1024,
): string[] {
  if (allowlist.length === 0) throw new FileAccessError('File upload allowlist is empty.');
  const roots = allowlist.map((root) => realPathOrResolve(root));
  return files.map((file) => {
    const resolved = realPathOrResolve(file);
    if (!roots.some((root) => isWithin(root, resolved))) {
      throw new FileAccessError('Upload path is outside the configured allowlist.');
    }
    const stats = fs.statSync(resolved);
    if (!stats.isFile()) throw new FileAccessError('Upload target is not a regular file.');
    if (stats.size > maxFileBytes) throw new FileAccessError('Upload file exceeds the size limit.');
    return resolved;
  });
}

function realPathOrResolve(value: string): string {
  const resolved = path.resolve(value);
  return fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}
