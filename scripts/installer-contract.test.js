const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const powershell = fs.readFileSync(path.join(root, 'scripts', 'install.ps1'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'scripts', 'install.sh'), 'utf8');

const skillDirectoryUrl = 'https://github.com/err0rgod/skills/tree/main/conduit';
const skillEntryUrl = 'https://raw.githubusercontent.com/err0rgod/skills/main/conduit/SKILL.md';

test('installers resolve the extension release independently from the backend', () => {
  assert.match(powershell, /\[string\]\$ExtensionVersion/u);
  assert.match(powershell, /err0rgod\/conduit-extension/u);
  assert.match(powershell, /conduit-extension-\$extensionReleaseTag\.zip/u);
  assert.match(powershell, /\$extensionName\.sha256/u);
  assert.match(powershell, /Extension\\\$resolvedExtensionVersion/u);
  assert.doesNotMatch(powershell, /conduit-extension-\$releaseVersion\.zip/u);

  assert.match(shell, /--extension-version/u);
  assert.match(shell, /err0rgod\/conduit-extension/u);
  assert.match(shell, /conduit-extension-\$extension_release_tag\.zip/u);
  assert.match(shell, /\$extension_name\.sha256/u);
  assert.match(shell, /extension\/\$resolved_extension_version/u);
  assert.doesNotMatch(shell, /conduit-extension-\$release_version\.zip/u);
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
