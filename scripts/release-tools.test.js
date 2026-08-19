const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { releaseVersion } = require('./release-check');
const { checksumLines } = require('./write-checksums');

test('release tag must match the repository version', () => {
  assert.equal(releaseVersion('v0.1.0'), '0.1.0');
  assert.throws(() => releaseVersion('v0.2.0'), /does not match/u);
});

test('release checksums are deterministic, sorted, and use asset basenames', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-release-tools-'));
  try {
    const beta = path.join(directory, 'beta.txt');
    const alpha = path.join(directory, 'alpha.txt');
    fs.writeFileSync(beta, 'beta');
    fs.writeFileSync(alpha, 'alpha');
    assert.deepEqual(checksumLines([beta, alpha]), [
      '8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8  alpha.txt',
      'f44e64e75f3948e9f73f8dfa94721c4ce8cbb4f265c4790c702b2d41cfbf2753  beta.txt',
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
