const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir);
}

fs.copyFileSync(path.join(__dirname, 'manifest.json'), path.join(distDir, 'manifest.json'));

if (fs.existsSync(path.join(__dirname, 'popup.html'))) {
  fs.copyFileSync(path.join(__dirname, 'popup.html'), path.join(distDir, 'popup.html'));
}

console.log('Extension packaged in dist/');
