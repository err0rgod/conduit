import { expect, test } from '@playwright/test';
import { chromium, BrowserContext, Worker } from '@playwright/test';
import { createServer, Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Daemon } from '../../apps/daemon/src/index';
import { ConduitClient } from '../../packages/daemon-client/src/index';

const token = 'e2e-token-'.padEnd(64, '0');
let daemon: Daemon;
let daemonPort: number;
let fixtureServer: Server;
let fixturePort: number;
let context: BrowserContext;
let profilePath: string;

test.beforeAll(async () => {
  const extensionPath = path.resolve('apps/extension/dist');
  await grantFixtureHostPermission(extensionPath);

  fixtureServer = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><head><title>Conduit fixture</title></head><body>
      <label for="message">Message</label><input id="message" />
      <button id="activate" onclick="document.querySelector('#result').textContent='clicked'">Activate</button>
      <output id="result">idle</output>
    </body></html>`);
  });
  fixturePort = await listen(fixtureServer);

  daemon = new Daemon({
    auth: {
      ensureToken: () => token,
      verifyToken: (candidate) => candidate === token,
    },
  });
  daemonPort = await daemon.start(0);
  profilePath = await mkdtemp(path.join(tmpdir(), 'conduit-e2e-'));
  context = await chromium.launchPersistentContext(profilePath, {
    channel: 'chromium',
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  const worker = await extensionWorker(context);
  await configureExtension(context, worker, daemonPort, token);
  await expect.poll(async () => (await client().health()).extensionConnected).toBe(true);
});

test.afterAll(async () => {
  await context?.close();
  await daemon?.stop();
  await closeServer(fixtureServer);
  if (profilePath) await rm(profilePath, { recursive: true, force: true });
});

test('executes the browser vertical slice through the authenticated daemon', async () => {
  const conduit = client();
  const opened = await conduit.browser('browser.open_tab');
  const tabId = payloadTabId(opened);
  const url = `http://127.0.0.1:${fixturePort}/fixture`;

  expect((await conduit.browser('browser.list_tabs')).success).toBe(true);
  expect((await conduit.browser('browser.navigate', { tabId, url })).success).toBe(true);
  await expect
    .poll(async () => {
      const response = await conduit.browser('browser.snapshot', { tabId, mode: 'interactive' });
      if (!response.success) return `${response.error.code}: ${response.error.message}`;
      return snapshotFrom(response.payload)?.title ?? JSON.stringify(response.payload);
    })
    .toBe('Conduit fixture');

  const snapshotResponse = await conduit.browser('browser.snapshot', {
    tabId,
    mode: 'interactive',
  });
  expect(snapshotResponse.success).toBe(true);
  if (!snapshotResponse.success) throw new Error(snapshotResponse.error.message);
  const snapshot = snapshotFrom(snapshotResponse.payload);
  if (!snapshot) throw new Error('Snapshot response did not contain a snapshot.');
  const input = snapshot.elements.find((element) => element.name === 'Message');
  const button = snapshot.elements.find((element) => element.name === 'Activate');
  expect(input?.elementId).toBeTruthy();
  expect(button?.elementId).toBeTruthy();

  expect(
    (
      await conduit.browser('browser.type', {
        tabId,
        target: { elementId: input?.elementId },
        text: 'hello from Conduit',
      })
    ).success,
  ).toBe(true);
  expect(
    (
      await conduit.browser('browser.click', {
        tabId,
        target: { elementId: button?.elementId },
      })
    ).success,
  ).toBe(true);

  const finalText = await conduit.browser('browser.get_visible_text', { tabId });
  expect(finalText.success && textFrom(finalText.payload)).toContain('clicked');
  const screenshot = await conduit.browser('browser.screenshot', { tabId, format: 'png' });
  if (!screenshot.success) throw new Error(`${screenshot.error.code}: ${screenshot.error.message}`);
  expect(screenshotData(screenshot.payload).length).toBeGreaterThan(100);
});

function client(): ConduitClient {
  return new ConduitClient({ baseUrl: `http://127.0.0.1:${daemonPort}`, token });
}

async function grantFixtureHostPermission(extensionPath: string): Promise<void> {
  const manifestPath = path.join(extensionPath, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  // The production manifest keeps this optional. The controlled test build grants it
  // so captureVisibleTab and scripting can be exercised without a manual Chrome prompt.
  manifest.host_permissions = ['<all_urls>'];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function extensionWorker(browserContext: BrowserContext): Promise<Worker> {
  const matches = (worker: Worker) =>
    worker.url().startsWith('chrome-extension://') && worker.url().endsWith('/background.js');
  const existing = browserContext.serviceWorkers().find(matches);
  return existing ?? browserContext.waitForEvent('serviceworker', { predicate: matches });
}

async function configureExtension(
  browserContext: BrowserContext,
  worker: Worker,
  port: number,
  daemonToken: string,
): Promise<void> {
  const extensionId = new URL(worker.url()).host;
  const popup = await browserContext.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator('#port').fill(String(port));
  await popup.locator('#token').fill(daemonToken);
  await popup.locator('#save').click();
  await popup.close();
}

function payloadTabId(response: Awaited<ReturnType<ConduitClient['browser']>>): number {
  if (!response.success) throw new Error(response.error.message);
  const payload = response.payload as { tab?: { id?: unknown } };
  if (typeof payload.tab?.id !== 'number')
    throw new Error('Open-tab response did not contain a tab ID.');
  return payload.tab.id;
}

function snapshotFrom(payload: unknown): {
  title: string;
  elements: Array<{ elementId: string; name: string }>;
} | null {
  return (
    (
      payload as {
        snapshot: { title: string; elements: Array<{ elementId: string; name: string }> };
      }
    ).snapshot ?? null
  );
}
function textFrom(payload: unknown): string {
  return (payload as { text: string }).text;
}
function screenshotData(payload: unknown): string {
  return (payload as { screenshot: { data: string } }).screenshot.data;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    }),
  );
}
function closeServer(server: Server | undefined): Promise<void> {
  return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
}
