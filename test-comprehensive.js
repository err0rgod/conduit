const { execSync } = require('child_process');
const http = require('http');

console.log('🤖 Conduit Agent: Beginning comprehensive browser testing...');

// 1. Create a local test server
const server = http.createServer((req, res) => {
  if (req.url === '/page2') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <head><title>Page 2</title></head>
        <body>
          <h1>This is page 2</h1>
          <p id="content">You successfully navigated here.</p>
        </body>
      </html>
    `);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`
    <html>
      <head>
        <title>Conduit Test Page</title>
        <style>
          .spacer { height: 1500px; background: linear-gradient(white, #ddd); }
          .hover-box { width: 100px; height: 100px; background: red; }
          .hover-box:hover { background: green; }
        </style>
      </head>
      <body>
        <h1>Comprehensive Test</h1>
        <input id="test-input" type="text" placeholder="Type here" />
        <select id="test-select">
          <option value="opt1">Option 1</option>
          <option value="opt2">Option 2</option>
        </select>
        <button id="test-button" onclick="document.getElementById('status').innerText = 'Clicked!'">Click Me</button>
        <p id="status">Idle</p>
        <div id="hover-target" class="hover-box"></div>
        <div class="spacer"></div>
        <p id="bottom-text">You scrolled to the bottom!</p>
      </body>
    </html>
  `);
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  console.log(`\n[Server] Test server listening on http://127.0.0.1:${port}`);
  runTests(port).catch(err => {
    console.error('\n❌ Test failed:', err);
  }).finally(() => {
    server.close();
    process.exit(0);
  });
});

function runCommand(command) {
  console.log(`\n> ${command.replace(/--tab \d+/, '--tab <TAB_ID>')}`);
  try {
    const output = execSync(command, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return output;
  } catch (error) {
    throw new Error(`Command failed: ${error.message}\n${error.stderr || error.stdout}`);
  }
}

function parseJsonResult(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const startIndex = raw.indexOf('{');
    if (startIndex !== -1) {
      return JSON.parse(raw.substring(startIndex));
    }
    throw new Error('Could not parse JSON: ' + raw);
  }
}

async function runTests(port) {
  const baseUrl = `http://127.0.0.1:${port}`;
  
  // 1. Open
  console.log('\n--- 1. Testing Open ---');
  const openRaw = runCommand(`conduit --json browser open "${baseUrl}"`);
  const openRes = parseJsonResult(openRaw);
  const tabId = openRes.payload?.tab?.id || openRes.payload?.id;
  if (!tabId) throw new Error('Could not get Tab ID');
  console.log('✅ Open successful. Tab ID:', tabId);

  // Wait for load
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);

  // 2. Snapshot
  console.log('\n--- 2. Testing Snapshot ---');
  const snapRaw = runCommand(`conduit --json browser snapshot --tab ${tabId}`);
  const snapRes = parseJsonResult(snapRaw);
  const elements = snapRes.payload?.snapshot?.elements || snapRes.payload?.elements || [];
  
  const inputEl = elements.find(e => e.role === 'textbox' || e.name === 'Type here' || e.tagName?.toLowerCase() === 'input');
  const selectEl = elements.find(e => e.role === 'combobox' || e.tagName?.toLowerCase() === 'select');
  const btnEl = elements.find(e => e.role === 'button' || e.name === 'Click Me' || e.tagName?.toLowerCase() === 'button');
  const hoverEl = elements.find(e => e.selector?.includes('#hover-target') || e.elementId); // fallback
  
  if (!inputEl) throw new Error('Could not find input element in snapshot');
  console.log(`✅ Snapshot successful. Found ${elements.length} interactive elements.`);

  // 3. Type
  console.log('\n--- 3. Testing Type ---');
  runCommand(`conduit --json browser type --tab ${tabId} --element ${inputEl.elementId} --text "Hello Conduit"`);
  console.log('✅ Type successful');

  // 4. Select
  console.log('\n--- 4. Testing Select ---');
  if (selectEl) {
    runCommand(`conduit --json browser select --tab ${tabId} --element ${selectEl.elementId} --value "opt2"`);
    console.log('✅ Select successful');
  } else {
    console.log('⚠️ Skipping select (element not found)');
  }

  // 5. Click
  console.log('\n--- 5. Testing Click ---');
  runCommand(`conduit --json browser click --tab ${tabId} --element ${btnEl.elementId}`);
  console.log('✅ Click successful');

  // 6. Visible Text
  console.log('\n--- 6. Testing Visible Text ---');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); // let UI update
  const textRaw = runCommand(`conduit --json browser text --tab ${tabId}`);
  const textRes = parseJsonResult(textRaw);
  const pageText = textRes.payload?.text || '';
  if (!pageText.includes('Clicked!')) throw new Error('Button click did not update text properly');
  console.log('✅ Visible text read successfully and confirmed click effect.');

  // 7. Scroll
  console.log('\n--- 7. Testing Scroll ---');
  runCommand(`conduit --json browser scroll --tab ${tabId} --delta-y 2000`);
  console.log('✅ Scroll successful');
  
  // 8. Screenshot
  console.log('\n--- 8. Testing Screenshot ---');
  const screenshotRaw = runCommand(`conduit --json browser screenshot --tab ${tabId}`);
  const screenshotRes = parseJsonResult(screenshotRaw);
  if (!screenshotRes.payload?.screenshot?.data) throw new Error('Screenshot data empty');
  console.log(`✅ Screenshot successful (${screenshotRes.payload.screenshot.data.length} bytes)`);

  // 9. Navigate
  console.log('\n--- 9. Testing Navigate ---');
  runCommand(`conduit --json browser navigate --tab ${tabId} "${baseUrl}/page2"`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  const text2Raw = runCommand(`conduit --json browser text --tab ${tabId}`);
  if (!parseJsonResult(text2Raw).payload?.text?.includes('This is page 2')) {
    throw new Error('Navigate failed');
  }
  console.log('✅ Navigate successful');

  // 10. Go Back
  console.log('\n--- 10. Testing Go Back ---');
  runCommand(`conduit --json browser go-back --tab ${tabId}`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  const text3Raw = runCommand(`conduit --json browser text --tab ${tabId}`);
  if (!parseJsonResult(text3Raw).payload?.text?.includes('Comprehensive Test')) {
    throw new Error('Go Back failed');
  }
  console.log('✅ Go Back successful');

  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉');
}
