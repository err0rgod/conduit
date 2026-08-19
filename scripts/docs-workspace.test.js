const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { docsCommand, findDocsWorkspace } = require('./docs-workspace');

test('documentation command uses a fixed Windows command-shell invocation', () => {
  assert.deepEqual(docsCommand('build', 'win32', { ComSpec: 'C:\\Windows\\cmd.exe' }), {
    executable: 'C:\\Windows\\cmd.exe',
    args: ['/d', '/s', '/c', 'pnpm run build'],
  });
  assert.deepEqual(docsCommand('dev', 'linux', {}), {
    executable: 'pnpm',
    args: ['run', 'dev'],
  });
});

test('documentation workspace resolves an explicit valid checkout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-docs-'));
  const docs = path.join(root, 'website');
  fs.mkdirSync(docs);
  fs.writeFileSync(path.join(docs, 'package.json'), JSON.stringify({ name: 'conduit-web' }));
  try {
    assert.equal(findDocsWorkspace(root, { CONDUIT_DOCS_PATH: docs }), docs);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('documentation workspace rejects unrelated packages', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-docs-'));
  const docs = path.join(root, 'website');
  fs.mkdirSync(docs);
  fs.writeFileSync(path.join(docs, 'package.json'), JSON.stringify({ name: 'another-project' }));
  try {
    assert.equal(findDocsWorkspace(root, { CONDUIT_DOCS_PATH: docs }), undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
