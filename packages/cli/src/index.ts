import { Command } from 'commander';
import { ConduitClient } from '@conduit/daemon-client';
import { ElementTarget, ResponseEnvelope } from '@conduit/protocol';

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

export function createProgram(client = new ConduitClient()): Command {
  const program = new Command();
  program
    .name('conduit')
    .description('Secure local-first browser control for AI agents')
    .version('0.1.0');

  program
    .command('status')
    .description('Show daemon and extension connectivity')
    .action(async () => printValue(await client.health()));

  const browser = program.command('browser').description('Control the connected Chromium browser');
  browser
    .command('tabs')
    .description('List browser tabs')
    .action(() => run(client, 'browser.list_tabs'));
  browser
    .command('active')
    .description('Get the active tab')
    .action(() => run(client, 'browser.get_active_tab'));
  browser
    .command('open [url]')
    .description('Open a browser tab')
    .action((url?: string) => run(client, 'browser.open_tab', url ? { url } : {}));
  addTabCommand(client, browser, 'close', 'Close a tab', 'browser.close_tab');
  addTabCommand(client, browser, 'focus', 'Focus a tab', 'browser.focus_tab');
  addTabCommand(client, browser, 'back', 'Go back in a tab', 'browser.go_back');
  addTabCommand(client, browser, 'forward', 'Go forward in a tab', 'browser.go_forward');
  addTabCommand(client, browser, 'reload', 'Reload a tab', 'browser.reload');

  browser
    .command('navigate <url>')
    .description('Navigate the active or selected tab')
    .option('--tab <id>', 'Target tab ID')
    .action((url: string, options: TabOptions) =>
      run(client, 'browser.navigate', { ...optionalTab(options), url }),
    );
  browser
    .command('snapshot')
    .description('Capture a structured page snapshot')
    .option('--tab <id>', 'Target tab ID')
    .option('--mode <mode>', 'Snapshot mode', 'compact')
    .action((options: TabOptions & { mode: string }) =>
      run(client, 'browser.snapshot', { ...optionalTab(options), mode: options.mode }),
    );
  browser
    .command('text')
    .description('Read visible page text')
    .option('--tab <id>', 'Target tab ID')
    .action((options: TabOptions) => run(client, 'browser.get_visible_text', optionalTab(options)));

  addElementOptions(browser.command('click').description('Click an element')).action(
    (options: ElementOptions) =>
      run(client, 'browser.click', { ...optionalTab(options), target: elementTarget(options) }),
  );
  addElementOptions(browser.command('type <value>').description('Type into an element')).action(
    (value: string, options: ElementOptions) =>
      run(client, 'browser.type', {
        ...optionalTab(options),
        target: elementTarget(options),
        text: value,
      }),
  );
  addElementOptions(
    browser.command('clear').description('Clear an input or editable element'),
  ).action((options: ElementOptions) =>
    run(client, 'browser.clear', { ...optionalTab(options), target: elementTarget(options) }),
  );
  addElementOptions(
    browser.command('select <values...>').description('Select one or more option values'),
  ).action((values: string[], options: ElementOptions) =>
    run(client, 'browser.select', {
      ...optionalTab(options),
      target: elementTarget(options),
      values,
    }),
  );
  addElementOptions(
    browser.command('hover').description('Move the browser pointer to an element'),
  ).action((options: ElementOptions) =>
    run(client, 'browser.hover', { ...optionalTab(options), target: elementTarget(options) }),
  );
  addElementOptions(browser.command('scroll').description('Scroll the page or an element'))
    .option('--x <pixels>', 'Horizontal delta', '0')
    .option('--y <pixels>', 'Vertical delta', '0')
    .action((options: ElementOptions & { x: string; y: string }) =>
      run(client, 'browser.scroll', {
        ...optionalTab(options),
        ...(optionalElementTarget(options) ? { target: optionalElementTarget(options) } : {}),
        deltaX: Number(options.x),
        deltaY: Number(options.y),
      }),
    );
  browser
    .command('key <key>')
    .description('Press a browser key using the optional debugger permission')
    .option('--tab <id>', 'Target tab ID')
    .option('--modifier <modifier...>', 'Alt, Control, Meta, or Shift')
    .action((key: string, options: TabOptions & { modifier?: string[] }) =>
      run(client, 'browser.press_key', {
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
      run(client, 'browser.wait_for', {
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
    run(client, 'browser.upload_file', {
      ...optionalTab(options),
      target: elementTarget(options),
      files,
    }),
  );
  browser
    .command('downloads')
    .description('List recent browser downloads')
    .action(() => run(client, 'browser.get_downloads'));
  browser
    .command('screenshot')
    .description('Capture the visible tab')
    .option('--tab <id>', 'Target tab ID')
    .option('--format <format>', 'png or jpeg', 'png')
    .action((options: TabOptions & { format: string }) =>
      run(client, 'browser.screenshot', { ...optionalTab(options), format: options.format }),
    );

  return program;
}

function addTabCommand(
  client: ConduitClient,
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
    .action((tabId: string) => run(client, type, { tabId: parseTabId(tabId) }));
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

async function run(
  client: ConduitClient,
  type: Parameters<ConduitClient['browser']>[0],
  payload: unknown = {},
): Promise<void> {
  printResponse(await client.browser(type, payload));
}

function printResponse(response: ResponseEnvelope): void {
  printValue(response);
  if (!response.success) process.exitCode = 1;
}

function printValue(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

void createProgram()
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Conduit command failed.'}\n`);
    process.exitCode = 1;
  });
