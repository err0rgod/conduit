const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function checksumLines(files) {
  return [...files]
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)))
    .map((file) => {
      if (!fs.statSync(file).isFile()) throw new Error(`Release asset is not a file: ${file}`);
      const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      return `${digest}  ${path.basename(file)}`;
    });
}

if (require.main === module) {
  try {
    const outputPath = process.argv[2];
    const files = process.argv.slice(3);
    if (!outputPath || files.length === 0) {
      throw new Error('Usage: node scripts/write-checksums.js <output> <asset>...');
    }
    fs.writeFileSync(outputPath, `${checksumLines(files).join('\n')}\n`, { mode: 0o600 });
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Checksum generation failed.'}\n`,
    );
    process.exitCode = 1;
  }
}

module.exports = { checksumLines };
