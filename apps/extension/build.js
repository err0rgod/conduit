const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = __dirname;
const distDir = path.join(root, 'dist');

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

async function build() {
  await esbuild.build({
    entryPoints: {
      background: path.join(root, 'src', 'background.ts'),
      popup: path.join(root, 'src', 'popup.ts'),
    },
    outdir: distDir,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome120', 'edge120'],
    sourcemap: false,
    logLevel: 'info',
  });

  fs.copyFileSync(path.join(root, 'manifest.json'), path.join(distDir, 'manifest.json'));
  fs.copyFileSync(path.join(root, 'popup.html'), path.join(distDir, 'popup.html'));
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
