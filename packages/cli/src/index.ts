import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { Command } from 'commander';
import { ConfigStore } from '@conduit/config';
import { ConduitClient } from '@conduit/daemon-client';
import { ElementTarget, ResponseEnvelope } from '@conduit/protocol';
import { LocalAuth } from '@conduit/security';
import { DaemonLifecycle, daemonBaseUrl } from './lifecycle';
import { resolveExtensionPath, runDoctor } from './doctor';

interface TabOptions {
  tab?: string;
}

interface ElementOptions extends TabOptions {
  element?: string;
  selector?: string;
  role?: string;
  name?: string;
  label?: string;
  text?: string;
}

export interface CliServices {
  client: ConduitClient;
  configStore: ConfigStore;
  lifecycle: DaemonLifecycle;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
}

export function createProgram(overrides: Partial<CliServices> = {}): Command {
  const configStore = overrides.configStore ?? new ConfigStore();
  const lifecycle = overrides.lifecycle ?? new DaemonLifecycle({ configStore });
  const client =
    overrides.client ?? new ConduitClient({ baseUrl: daemonBaseUrl(configStore.load()) });
  const stdout = overrides.stdout ?? process.stdout;
  const program = new Command();
  const output = (value: unknown): void => printValue(program, stdout, value);
  program
    .name('conduit')
    .description('Open-source, local-first browser control bridge for AI agents')
    .version('0.1.0')
    .option('--json', 'Emit machine-readable JSON');

  program
    .command('start')
    .description('Start the Conduit daemon in the background')
    .action(async () => output(await lifecycle.start()));
  program
    .command('stop')
    .description('Gracefully stop the managed Conduit daemon')
    .option('--force', 'Signal the recorded PID when daemon identity cannot be verified')
    .action(async (options: { force?: boolean }) => output(await lifecycle.stop(options.force)));
  program
    .command('restart')
    .description('Restart the managed Conduit daemon')
    .option('--force', 'Allow forced stop when daemon identity cannot be verified')
    .action(async (options: { force?: boolean }) => output(await lifecycle.restart(options.force)));
  program
    .command('status')
    .description('Show daemon and extension connectivity')
    .action(async () => output(await lifecycle.status()));
  program
    .command('logs')
    .description('Show recent daemon process logs')
    .option('--lines <count>', 'Number of lines', '100')
    .action((options: { lines: string }) => {
      const lines = parsePositiveInteger(options.lines, 'line count');
      output({ path: lifecycle.getLogPath(), lines: lifecycle.readLogs(lines) });
    });
  program
    .command('doctor')
    .description('Run environment, configuration, daemon, extension, MCP, and safety checks')
    .action(async () => {
      const report = await runDoctor(configStore, lifecycle);
      output(report);
      if (!report.healthy) process.exitCode = 1;
    });

  const pair = program
    .command('pair')
    .description('Create and approve short-lived remote-device pairing requests')
    .action(async () => output(await client.startPairing()));
  pair
    .command('pending')
    .description('List pending pairing approvals')
    .action(async () => output(await client.listPairings()));
  pair
    .command('approve <pairingId>')
    .description('Approve a pairing with an explicit permission subset')
    .option('--permission <permission...>', 'Permission grants', ['browser.read'])
    .action(async (pairingId: string, options: { permission: string[] }) =>
      output(await client.respondToPairing(pairingId, true, options.permission)),
    );
  pair
    .command('deny <pairingId>')
    .description('Deny a pending pairing')
    .action(async (pairingId: string) => output(await client.respondToPairing(pairingId, false)));
  program
    .command('devices')
    .description('List trusted and revoked remote devices')
    .action(async () => output(await client.listDevices()));
  program
    .command('revoke <deviceId>')
    .description('Revoke a trusted device and its active sessions')
    .action(async (deviceId: string) => output({ revoked: await client.revokeDevice(deviceId) }));

  program
    .command('permissions')
    .description('Show configured permissions and domain policy')
    .action(() => output(configStore.load().security));
  program
    .command('allow-domain <domain>')
    .description('Add an exact or explicit wildcard domain to the allowlist')
    .action((domain: string) => output(updateDomain(configStore, domain, true)));
  program
    .command('deny-domain <domain>')
    .description('Add an exact or explicit wildcard domain to the blocklist')
    .action((domain: string) => output(updateDomain(configStore, domain, false)));

  const config = program
    .command('config')
    .description('Inspect or update validated Conduit configuration')
    .action(() => output(configStore.load()));
  config
    .command('path')
    .description('Print the active configuration path')
    .action(() => output({ path: configStore.getPath() }));
  config
    .command('set <path> <value>')
    .description('Set a known configuration value; JSON values are accepted')
    .action((configPath: string, value: string) => output(configStore.update(configPath, value)));

  const extension = program
    .command('extension')
    .description('Manage the unpacked browser extension');
  extension
    .command('path')
    .description('Print the built extension directory')
    .action(() => output({ path: resolveExtensionPath() }));
  extension
    .command('token')
    .description('Explicitly reveal the local extension authentication token')
    .action(() =>
      output({
        token: new LocalAuth().ensureToken(),
        warning: 'Treat this token as a secret. Do not paste it into websites or commit it.',
      }),
    );
  extension
    .command('install-help')
    .description('Show Chromium unpacked-extension installation steps')
    .action(() =>
      output({
        steps: [
          'Run pnpm extension:build.',
          'Open chrome://extensions or edge://extensions.',
          'Enable Developer mode.',
          `Choose Load unpacked and select ${resolveExtensionPath()}.`,
          'Run conduit extension token and keep the output private.',
          'Open the Conduit extension popup and configure the daemon port and local token.',
        ],
      }),
    );
  program
    .command('mcp')
    .description('Run the Conduit MCP server over stdio')
    .action(async () => runMcpServer());

  addBrowserCommands(program, client, output);
  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  await createProgram().parseAsync(argv);
}

function addBrowserCommands(
  program: Command,
  client: ConduitClient,
  output: (value: unknown) => void,
): void {
  const run = async (
    type: Parameters<ConduitClient['browser']>[0],
    payload: unknown = {},
  ): Promise<void> => {
    const response = await client.browser(type, payload);
    output(response);
    if (!response.success) process.exitCode = 2;
  };
  const browser = program.command('browser').description('Control the connected Chromium browser');
  browser
    .command('tabs')
    .description('List browser tabs')
    .action(() => run('browser.list_tabs'));
  browser
    .command('active')
    .description('Get the active tab')
    .action(() => run('browser.get_active_tab'));
  browser
    .command('open [url]')
    .description('Open a browser tab')
    .action((url?: string) => run('browser.open_tab', url ? { url } : {}));
  addTabCommand(run, browser, 'close', 'Close a tab', 'browser.close_tab');
  addTabCommand(run, browser, 'focus', 'Focus a tab', 'browser.focus_tab');
  addTabCommand(run, browser, 'back', 'Go back in a tab', 'browser.go_back');
  addTabCommand(run, browser, 'forward', 'Go forward in a tab', 'browser.go_forward');
  addTabCommand(run, browser, 'reload', 'Reload a tab', 'browser.reload');
  browser
    .command('navigate <url>')
    .description('Navigate the active or selected tab')
    .option('--tab <id>', 'Target tab ID')
    .action((url: string, options: TabOptions) =>
      run('browser.navigate', { ...optionalTab(options), url }),
    );
  browser
    .command('snapshot')
    .description('Capture a structured page snapshot')
    .option('--tab <id>', 'Target tab ID')
    .option('--mode <mode>', 'Snapshot mode', 'compact')
    .action((options: TabOptions & { mode: string }) =>
      run('browser.snapshot', { ...optionalTab(options), mode: options.mode }),
    );
  browser
    .command('text')
    .description('Read visible page text')
    .option('--tab <id>', 'Target tab ID')
    .action((options: TabOptions) => run('browser.get_visible_text', optionalTab(options)));
  addElementOptions(browser.command('click').description('Click an element')).action(
    (options: ElementOptions) =>
      run('browser.click', { ...optionalTab(options), target: elementTarget(options) }),
  );
  addElementOptions(browser.command('type <value>').description('Type into an element')).action(
    (value: string, options: ElementOptions) =>
      run('browser.type', {
        ...optionalTab(options),
        target: elementTarget(options),
        text: value,
      }),
  );
  addElementOptions(browser.command('clear').description('Clear an input')).action(
    (options: ElementOptions) =>
      run('browser.clear', { ...optionalTab(options), target: elementTarget(options) }),
  );
  addElementOptions(browser.command('select <values...>').description('Select options')).action(
    (values: string[], options: ElementOptions) =>
      run('browser.select', {
        ...optionalTab(options),
        target: elementTarget(options),
        values,
      }),
  );
  addElementOptions(browser.command('hover').description('Hover an element')).action(
    (options: ElementOptions) =>
      run('browser.hover', { ...optionalTab(options), target: elementTarget(options) }),
  );
  addElementOptions(browser.command('scroll').description('Scroll the page or an element'))
    .option('--x <pixels>', 'Horizontal delta', '0')
    .option('--y <pixels>', 'Vertical delta', '0')
    .action((options: ElementOptions & { x: string; y: string }) => {
      const target = optionalElementTarget(options);
      return run('browser.scroll', {
        ...optionalTab(options),
        ...(target ? { target } : {}),
        deltaX: Number(options.x),
        deltaY: Number(options.y),
      });
    });
  browser
    .command('key <key>')
    .description('Press a browser key')
    .option('--tab <id>', 'Target tab ID')
    .option('--modifier <modifier...>', 'Alt, Control, Meta, or Shift')
    .action((key: string, options: TabOptions & { modifier?: string[] }) =>
      run('browser.press_key', {
        ...optionalTab(options),
        key,
        modifiers: options.modifier ?? [],
      }),
    );
  browser
    .command('wait')
    .description('Wait for a selector, text, URL fragment, or loading state')
    .option('--tab <id>', 'Target tab ID')
    .option('--selector <css>', 'CSS selector')
    .option('--text <text>', 'Visible text')
    .option('--url <fragment>', 'URL fragment')
    .option('--state <state>', 'loading, interactive, or complete')
    .option('--timeout <ms>', 'Timeout in milliseconds', '15000')
    .action((options: TabOptions & Record<string, string>) =>
      run('browser.wait_for', {
        ...optionalTab(options),
        ...(options.selector ? { selector: options.selector } : {}),
        ...(options.text ? { text: options.text } : {}),
        ...(options.url ? { url: options.url } : {}),
        ...(options.state ? { state: options.state } : {}),
        timeoutMs: Number(options.timeout),
      }),
    );
  addElementOptions(
    browser.command('upload <files...>').description('Upload allowlisted files after confirmation'),
  ).action((files: string[], options: ElementOptions) =>
    run('browser.upload_file', {
      ...optionalTab(options),
      target: elementTarget(options),
      files,
    }),
  );
  browser
    .command('downloads')
    .description('List recent browser downloads')
    .action(() => run('browser.get_downloads'));
  browser
    .command('screenshot')
    .description('Capture the visible tab')
    .option('--tab <id>', 'Target tab ID')
    .option('--format <format>', 'png or jpeg', 'png')
    .action((options: TabOptions & { format: string }) =>
      run('browser.screenshot', { ...optionalTab(options), format: options.format }),
    );
}

function addTabCommand(
  run: (type: Parameters<ConduitClient['browser']>[0], payload?: unknown) => Promise<void>,
  parent: Command,
  name: string,
  description: string,
  type:
    | 'browser.close_tab'
    | 'browser.focus_tab'
    | 'browser.go_back'
    | 'browser.go_forward'
    | 'browser.reload',
): void {
  parent
    .command(`${name} <tabId>`)
    .description(description)
    .action((tabId: string) => run(type, { tabId: parseTabId(tabId) }));
}

function addElementOptions(command: Command): Command {
  return command
    .option('--tab <id>', 'Target tab ID')
    .option('--element <id>', 'Temporary snapshot element ID')
    .option('--selector <css>', 'CSS selector')
    .option('--role <role>', 'Accessibility role (requires --name)')
    .option('--name <name>', 'Accessible name (with --role)')
    .option('--label <label>', 'Associated label')
    .option('--text <text>', 'Exact visible text');
}

function optionalTab(options: TabOptions): { tabId?: number } {
  return options.tab ? { tabId: parseTabId(options.tab) } : {};
}

function parseTabId(value: string): number {
  const tabId = Number(value);
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error(`Invalid tab ID: ${value}`);
  return tabId;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

function elementTarget(options: ElementOptions): ElementTarget {
  if (options.element) return { elementId: options.element };
  if (options.selector) return { selector: options.selector };
  if (options.role && options.name) return { role: options.role, name: options.name };
  if (options.label) return { label: options.label };
  if (options.text) return { text: options.text };
  throw new Error('Provide --element, --selector, --role with --name, --label, or --text.');
}

function optionalElementTarget(options: ElementOptions): ElementTarget | undefined {
  try {
    return elementTarget(options);
  } catch {
    return undefined;
  }
}

function updateDomain(configStore: ConfigStore, domain: string, allowed: boolean): unknown {
  const config = configStore.load();
  const normalized = domain.trim().toLowerCase();
  const target = allowed ? config.security.allowedDomains : config.security.blockedDomains;
  const opposite = allowed ? config.security.blockedDomains : config.security.allowedDomains;
  if (!target.includes(normalized)) target.push(normalized);
  const oppositeIndex = opposite.indexOf(normalized);
  if (oppositeIndex >= 0) opposite.splice(oppositeIndex, 1);
  return configStore.save(config);
}

function printValue(
  program: Command,
  stdout: Pick<NodeJS.WriteStream, 'write'>,
  value: unknown,
): void {
  const formatted = program.opts<{ json?: boolean }>().json
    ? JSON.stringify(value, null, 2)
    : formatHuman(value);
  stdout.write(`${formatted}\n`);
}

function formatHuman(value: unknown, indent = ''): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '(none)';
    return value.map((item) => `${indent}- ${formatHuman(item, `${indent}  `)}`).join('\n');
  }
  return Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => {
      if (typeof entry === 'object' && entry !== null) {
        return `${indent}${key}:\n${formatHuman(entry, `${indent}  `)}`;
      }
      return `${indent}${key}: ${String(entry)}`;
    })
    .join('\n');
}

async function runMcpServer(): Promise<void> {
  let entry: string;
  try {
    entry = path.join(path.dirname(require.resolve('@conduit/mcp-server')), 'main.js');
  } catch {
    throw new Error('MCP server build not found. Run pnpm build first.');
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [entry], { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`MCP server exited with code ${code ?? 'unknown'}.`));
    });
  });
}
