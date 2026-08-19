import { expect, test } from '@playwright/test';
import { chromium, BrowserContext, Worker } from '@playwright/test';
import { createServer, Server } from 'node:http';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Daemon } from '../../apps/daemon/src/index';
import { ConduitClient } from '../../packages/daemon-client/src/index';
import { ConfigStore } from '../../packages/config/src/index';
import { NativeHostInstaller } from '../../packages/cli/src/native-host';
import { SecurityPolicy } from '../../packages/security/src/policy';
import { AuditLogger, StoredAuditEvent } from '../../packages/security/src/audit';

const token = 'e'.repeat(64);
let daemon: Daemon;
let daemonPort: number;
let fixtureServer: Server;
let fixturePort: number;
let context: BrowserContext;
let worker: Worker;
let testRoot: string;
let temporaryNativeHost: NativeHostInstaller | undefined;
const auditEvents: StoredAuditEvent[] = [];

test.beforeAll(async () => {
  const extensionSourcePath = path.resolve(
    process.env.CONDUIT_EXTENSION_PATH ?? '../conduit-extension/apps/extension/dist',
  );

  fixtureServer = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><head><title>Conduit fixture</title></head><body>
      <label for="message">Message</label><input id="message" />
      <label for="choice">Choice</label><select id="choice"><option value="one">One</option><option value="two">Two</option></select>
      <button id="activate" onclick="document.querySelector('#result').textContent='clicked'">Activate</button>
      <output id="result">idle</output>
      <script>setTimeout(() => { const item=document.createElement('div'); item.id='delayed'; item.textContent='ready later'; document.body.append(item); }, 250)</script>
    </body></html>`);
  });
  fixturePort = await listen(fixtureServer);

  daemon = new Daemon({
    auth: {
      ensureToken: () => token,
      verifyToken: (candidate) => candidate === token,
    },
    policy: new SecurityPolicy({
      permissions: ['browser.read', 'browser.navigate', 'browser.interact', 'browser.forms'],
      domainMode: 'allowlist',
      allowedDomains: ['127.0.0.1'],
      allowLocalhost: true,
    }),
    audit: new AuditLogger({ sink: (event) => auditEvents.push(event) }),
  });
  daemonPort = await daemon.start(0);
  testRoot = await mkdtemp(path.join(tmpdir(), 'conduit-e2e-'));
  const extensionPath = path.join(testRoot, 'extension');
  await prepareExtensionWithFixtureGrant(extensionSourcePath, extensionPath);
  const profilePath = path.join(testRoot, 'profile');
  const dataPath = path.join(testRoot, 'data');
  const configPath = path.join(dataPath, 'config.json');
  const nativeHostHome = path.join(testRoot, 'native-home');
  await mkdir(dataPath, { recursive: true });
  await writeFile(path.join(dataPath, 'auth.json'), `${JSON.stringify({ token }, null, 2)}\n`, {
    mode: 0o600,
  });
  new ConfigStore({ configPath }).save({
    daemon: { port: daemonPort },
    security: {
      permissions: ['browser.read', 'browser.navigate', 'browser.interact', 'browser.forms'],
      domainMode: 'allowlist',
      allowedDomains: ['127.0.0.1'],
      allowLocalhost: true,
    },
  });

  const nativeEnvironment = {
    ...process.env,
    CONDUIT_CONFIG_PATH: configPath,
    CONDUIT_DATA_DIR: dataPath,
    HOME: nativeHostHome,
  };
  const nativeHost = new NativeHostInstaller({
    ...(process.platform === 'win32' ? {} : { homeDirectory: nativeHostHome }),
    cliEntryPath: path.resolve('packages/cli/bin/conduit.js'),
  });
  if (process.platform === 'win32') {
    expect(nativeHost.status().installed, 'Run `conduit setup` before Windows E2E tests.').toBe(
      true,
    );
  } else {
    const installed = nativeHost.install();
    expect(installed.installed).toBe(true);
    const sourceManifest = installed.manifestPaths?.at(-1);
    if (!sourceManifest) throw new Error('Native host installation did not return a manifest.');
    const profileManifestDirectory = path.join(profilePath, 'NativeMessagingHosts');
    await mkdir(profileManifestDirectory, { recursive: true });
    await copyFile(
      sourceManifest,
      path.join(profileManifestDirectory, path.basename(sourceManifest)),
    );
    temporaryNativeHost = nativeHost;
  }

  context = await chromium.launchPersistentContext(profilePath, {
    channel: 'chromium',
    headless: false,
    env: nativeEnvironment,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  worker = await extensionWorker(context);
  expect(new URL(worker.url()).host).toBe('jkdlmcpkgkooilffjegfjmkanoelbmbl');
  await expect
    .poll(async () => (await client().health()).extensionConnected, { timeout: 45_000 })
    .toBe(true);
});

test.afterAll(async () => {
  await context?.close();
  temporaryNativeHost?.uninstall();
  await daemon?.stop();
  await closeServer(fixtureServer);
  if (testRoot) await rm(testRoot, { recursive: true, force: true });
});

test('executes the browser vertical slice through the authenticated daemon', async () => {
  const conduit = client();
  const opened = await conduit.browser('browser.open_tab');
  if (!opened.success) {
    const diagnostic = await worker.evaluate(() => globalThis.__conduitDiagnostic);
    throw new Error(
      `${opened.error.message}\nExtension: ${JSON.stringify(diagnostic)}\nAudit: ${JSON.stringify(auditEvents, null, 2)}`,
    );
  }
  const tabId = payloadTabId(opened);
  const url = `http://127.0.0.1:${fixturePort}/fixture`;

  expect((await conduit.browser('browser.list_tabs')).success).toBe(true);
  expect((await conduit.browser('browser.navigate', { tabId, url })).success).toBe(true);
  await expect
    .poll(
      async () => {
        const response = await conduit.browser('browser.snapshot', { tabId, mode: 'interactive' });
        if (!response.success) return `${response.error.code}: ${response.error.message}`;
        return snapshotFrom(response.payload)?.title ?? JSON.stringify(response.payload);
      },
      { timeout: 45_000 },
    )
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
  const select = snapshot.elements.find((element) => element.role === 'combobox');
  expect(input?.elementId).toBeTruthy();
  expect(button?.elementId).toBeTruthy();
  expect(select?.elementId).toBeTruthy();

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
      await conduit.browser('browser.select', {
        tabId,
        target: { elementId: select?.elementId },
        values: ['two'],
      })
    ).success,
  ).toBe(true);
  expect((await conduit.browser('browser.scroll', { tabId, deltaX: 0, deltaY: 200 })).success).toBe(
    true,
  );
  expect(
    (
      await conduit.browser('browser.wait_for', {
        tabId,
        selector: '#delayed',
        timeoutMs: 3_000,
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
  expect(
    (
      await conduit.browser('browser.clear', {
        tabId,
        target: { elementId: input?.elementId },
      })
    ).success,
  ).toBe(true);
  const permissionFailure = await conduit.browser('browser.hover', {
    tabId,
    target: { elementId: button?.elementId },
  });
  expect(permissionFailure.success).toBe(false);
  if (!permissionFailure.success) expect(permissionFailure.error.code).toBe('PERMISSION_DENIED');
  const screenshot = await conduit.browser('browser.screenshot', { tabId, format: 'png' });
  if (!screenshot.success) throw new Error(`${screenshot.error.code}: ${screenshot.error.message}`);
  expect(screenshotData(screenshot.payload).length).toBeGreaterThan(100);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await expect(popup.locator('#control-state')).toHaveText('ready');
  await expect(popup.locator('#last-action')).toContainText('screenshot');

  await popup.locator('#disconnect').click();
  await expect
    .poll(async () => (await conduit.health()).extensionConnected, { timeout: 10_000 })
    .toBe(false);
  await expect(popup.locator('#control-state')).toHaveText('paused');
  await expect(popup.locator('#resume')).toBeVisible();

  await popup.locator('#resume').click();
  await expect
    .poll(async () => (await conduit.health()).extensionConnected, { timeout: 45_000 })
    .toBe(true);
  await expect(popup.locator('#control-state')).toHaveText('ready');
  await expect(popup.locator('#disconnect')).toBeVisible();
  await popup.close();
});

function client(): ConduitClient {
  return new ConduitClient({ baseUrl: `http://127.0.0.1:${daemonPort}`, token });
}

async function extensionWorker(browserContext: BrowserContext): Promise<Worker> {
  const matches = (worker: Worker) =>
    worker.url().startsWith('chrome-extension://') && worker.url().endsWith('/background.js');
  const existing = browserContext.serviceWorkers().find(matches);
  return existing ?? browserContext.waitForEvent('serviceworker', { predicate: matches });
}

async function prepareExtensionWithFixtureGrant(
  source: string,
  destination: string,
): Promise<void> {
  await cp(source, destination, { recursive: true });
  const manifestPath = path.join(destination, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  if (manifest.host_permissions !== undefined) {
    throw new Error('Production extension unexpectedly includes default host permissions.');
  }
  // Chromium's permission prompt and toolbar activeTab grant are browser UI with no supported
  // CI auto-accept switch. The disposable test copy gets captureVisibleTab capability; daemon
  // policy still confines it to the controlled fixture. Production remains optional per-origin.
  manifest.host_permissions = ['<all_urls>'];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

function payloadTabId(response: Awaited<ReturnType<ConduitClient['browser']>>): number {
  if (!response.success) {
    throw new Error(`${response.error.message}\nAudit: ${JSON.stringify(auditEvents, null, 2)}`);
  }
  const payload = response.payload as { tab?: { id?: unknown } };
  if (typeof payload.tab?.id !== 'number')
    throw new Error('Open-tab response did not contain a tab ID.');
  return payload.tab.id;
}

function snapshotFrom(payload: unknown): {
  title: string;
  elements: Array<{ elementId: string; name: string; role?: string }>;
} | null {
  return (
    (
      payload as {
        snapshot: {
          title: string;
          elements: Array<{ elementId: string; name: string; role?: string }>;
        };
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
