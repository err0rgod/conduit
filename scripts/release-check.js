const fs = require('node:fs');
const path = require('node:path');

function releaseVersion(tag, repositoryRoot = path.resolve(__dirname, '..')) {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
  );
  const version = packageJson.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error('The root package.json must contain a valid semantic version.');
  }
  if (tag && tag !== `v${version}`) {
    throw new Error(`Release tag ${tag} does not match package version v${version}.`);
  }
  return version;
}

if (require.main === module) {
  try {
    process.stdout.write(`${releaseVersion(process.argv[2])}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Release validation failed.'}\n`,
    );
    process.exitCode = 1;
  }
}

module.exports = { releaseVersion };
