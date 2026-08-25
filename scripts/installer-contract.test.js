const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const powershell = fs.readFileSync(path.join(root, 'scripts', 'install.ps1'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'scripts', 'install.sh'), 'utf8');

const skillDirectoryUrl = 'https://github.com/err0rgod/skills/tree/main/conduit';
const skillEntryUrl = 'https://raw.githubusercontent.com/err0rgod/skills/main/conduit/SKILL.md';
const chromeStoreId = 'gjhipjgiapijcdnflldnoenafeegmfpc';

test('installers install only the backend and direct users to browser stores', () => {
  for (const installer of [powershell, shell]) {
    assert.doesNotMatch(installer, /err0rgod\/conduit-extension/u);
    assert.doesNotMatch(installer, /extension-version/iu);
    assert.match(installer, /chromewebstore\.google\.com/u);
    assert.match(installer, new RegExp(chromeStoreId, 'u'));
    assert.match(installer, /microsoftedge\.microsoft\.com\/addons/u);
    assert.match(installer, /addons\.mozilla\.org/u);
    assert.match(installer, /conduit extension trust/u);
  }
});

test('installers publish portable Conduit skill locations', () => {
  for (const installer of [powershell, shell]) {
    assert.match(installer, new RegExp(escapeRegExp(skillDirectoryUrl), 'u'));
    assert.match(installer, new RegExp(escapeRegExp(skillEntryUrl), 'u'));
    assert.match(installer, /Agent Skill directory/u);
    assert.match(installer, /Agent Skill entry/u);
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
