const { execSync } = require('child_process');

console.log('🤖 Conduit Agent: Beginning autonomous Amazon search task...');

function runCommand(command) {
  try {
    console.log(`> ${command}`);
    const output = execSync(command, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return output;
  } catch (error) {
    console.error(`Command failed: ${error.message}`);
    if (error.stdout) console.error(error.stdout);
    process.exit(1);
  }
}

// 1. Open Amazon
console.log('\n[Step 1] Navigating to Amazon...');
const openRaw = runCommand(
  'conduit --json browser open "https://www.amazon.in/s?k=smartphone+under+30000"',
);
let tabId;
try {
  const openResult = JSON.parse(openRaw);
  tabId = openResult.payload?.tab?.id || openResult.payload?.id;
} catch (e) {
  console.log('Failed to parse open output as JSON.');
  process.exit(1);
}
if (!tabId) {
  console.log('Could not find tab ID in open result.');
  process.exit(1);
}
console.log(`Opened tab ID: ${tabId}`);

// 2. Wait for page to load
console.log('\n[Step 2] Waiting for search results to load (5 seconds)...');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);

// 3. Take a snapshot of the page to find interactive elements
console.log('\n[Step 3] Taking page snapshot...');
const snapshotRaw = runCommand(`conduit --json browser snapshot --tab ${tabId}`);

let snapshot;
try {
  snapshot = JSON.parse(snapshotRaw);
} catch (e) {
  console.log('Failed to parse snapshot output as JSON.');
  console.log(snapshotRaw.substring(0, 500) + '...');
  process.exit(1);
}

if (!snapshot.success) {
  console.error('Failed to take snapshot:', snapshot.error);
  process.exit(1);
}

// 4. Analyze snapshot for top result
console.log('\n[Step 4] Analyzing smartphones...');
const elements = snapshot.payload?.snapshot?.elements || snapshot.payload?.elements || [];
const products = elements.filter(
  (el) =>
    el.text &&
    (el.text.toLowerCase().includes('smartphone') || el.text.toLowerCase().includes('gb')) &&
    (el.role === 'link' || el.role === 'heading'),
);

if (products.length > 0) {
  console.log('✅ Found smartphones in the results:');
  products.slice(0, 3).forEach((p, idx) => {
    console.log(
      `  ${idx + 1}. [Element ID: ${p.elementId}] ${p.text.substring(0, 80).replace(/\n/g, ' ')}...`,
    );
  });

  console.log('\n[Step 5] Clicking the top result...');
  const topProductId = products[0].elementId;
  runCommand(`conduit browser click --tab ${tabId} --element ${topProductId}`);
  console.log('✅ Clicked! Task completed successfully.');
} else {
  console.log(
    '⚠️ Could not identify smartphone elements in the snapshot. The page might still be loading.',
  );
}
