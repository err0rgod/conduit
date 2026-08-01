import * as fs from 'node:fs';
import * as path from 'node:path';

export function resolveDistributionEntry(filename: string): string | undefined {
  return firstExisting([
    path.join(__dirname, filename),
    path.join(path.dirname(process.argv[1] ?? __filename), filename),
  ]);
}

export function resolveDistributionAsset(...segments: string[]): string | undefined {
  return firstExisting([
    path.resolve(__dirname, '..', ...segments),
    path.resolve(path.dirname(process.argv[1] ?? __filename), '..', ...segments),
  ]);
}

function firstExisting(candidates: string[]): string | undefined {
  return candidates.find((candidate) => fs.existsSync(candidate));
}
