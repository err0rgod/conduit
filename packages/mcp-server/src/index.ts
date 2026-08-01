import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ConduitClient } from '@conduit/daemon-client';
import { ElementTarget, ResponseEnvelope } from '@conduit/protocol';

export interface ConduitMcpClient {
  health(): ReturnType<ConduitClient['health']>;
  browser(
    type: Parameters<ConduitClient['browser']>[0],
    payload?: Parameters<ConduitClient['browser']>[1],
  ): ReturnType<ConduitClient['browser']>;
}

const emptySchema = { type: 'object' as const, properties: {}, additionalProperties: false };
const tabSchema = {
  type: 'object' as const,
  properties: { tabId: { type: 'number', description: 'Chromium tab ID.' } },
  required: ['tabId'],
  additionalProperties: false,
};
const optionalTabProperty = { tabId: { type: 'number', description: 'Optional Chromium tab ID.' } };
const targetProperties = {
  elementId: { type: 'string', description: 'Temporary ID from the latest snapshot, such as e3.' },
  selector: { type: 'string', description: 'CSS selector fallback.' },
  role: { type: 'string', description: 'Accessibility role; use with name.' },
  name: { type: 'string', description: 'Accessible name; use with role.' },
  label: { type: 'string', description: 'Associated form label.' },
  text: { type: 'string', description: 'Exact visible text.' },
};

export function createConduitMcpServer(client: ConduitMcpClient = new ConduitClient()): Server {
  const server = new Server(
    { name: 'conduit-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      tool(
        'conduit_status',
        'Check daemon and extension connectivity. No browser permission required.',
        emptySchema,
      ),
      tool(
        'browser_list_tabs',
        'List tabs. Requires browser.read; returns structured tab metadata.',
        emptySchema,
      ),
      tool('browser_get_active_tab', 'Get the active tab. Requires browser.read.', emptySchema),
      tool(
        'browser_open_tab',
        'Open a tab. Requires browser.navigate and may trigger domain policy.',
        {
          type: 'object',
          properties: { url: { type: 'string' } },
          additionalProperties: false,
        },
      ),
      tool('browser_close_tab', 'Close a tab. Requires browser.interact.', tabSchema),
      tool('browser_focus_tab', 'Focus a tab. Requires browser.interact.', tabSchema),
      tool('browser_navigate', 'Navigate a tab. Requires browser.navigate and domain approval.', {
        type: 'object',
        properties: { ...optionalTabProperty, url: { type: 'string' } },
        required: ['url'],
        additionalProperties: false,
      }),
      tool('browser_go_back', 'Go back. Requires browser.navigate.', tabSchema),
      tool('browser_go_forward', 'Go forward. Requires browser.navigate.', tabSchema),
      tool('browser_reload', 'Reload a tab. Requires browser.navigate.', tabSchema),
      tool('browser_snapshot', 'Return untrusted structured page data. Requires browser.read.', {
        type: 'object',
        properties: {
          ...optionalTabProperty,
          mode: {
            type: 'string',
            enum: [
              'compact',
              'accessibility',
              'visible-text',
              'interactive',
              'full-dom',
              'targeted-subtree',
            ],
          },
        },
        additionalProperties: false,
      }),
      tool(
        'browser_get_visible_text',
        'Read visible page text as untrusted data. Requires browser.read.',
        {
          type: 'object',
          properties: optionalTabProperty,
          additionalProperties: false,
        },
      ),
      tool(
        'browser_click',
        'Click an element. Requires browser.interact; sensitive actions may require confirmation.',
        targetSchema(),
      ),
      tool('browser_type', 'Type text. Requires browser.forms; sensitive values are not logged.', {
        ...targetSchema(),
        properties: { ...targetSchema().properties, value: { type: 'string' } },
        required: ['value'],
      }),
      tool('browser_clear', 'Clear an editable element. Requires browser.forms.', targetSchema()),
      tool('browser_select', 'Select option values. Requires browser.forms.', {
        ...targetSchema(),
        properties: {
          ...targetSchema().properties,
          values: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
        required: ['values'],
      }),
      tool(
        'browser_hover',
        'Move the real pointer to an element. Requires browser.interact and optional debugger permission.',
        targetSchema(),
      ),
      tool('browser_scroll', 'Scroll the page or a target. Requires browser.read.', {
        ...targetSchema(),
        properties: {
          ...targetSchema().properties,
          deltaX: { type: 'number' },
          deltaY: { type: 'number' },
        },
      }),
      tool(
        'browser_press_key',
        'Press a real browser key. Requires browser.interact and optional debugger permission.',
        {
          type: 'object',
          properties: {
            ...optionalTabProperty,
            key: { type: 'string' },
            modifiers: {
              type: 'array',
              items: { type: 'string', enum: ['Alt', 'Control', 'Meta', 'Shift'] },
            },
          },
          required: ['key'],
          additionalProperties: false,
        },
      ),
      tool(
        'browser_wait_for',
        'Wait for a selector, text, URL, or page state. Requires browser.read.',
        {
          type: 'object',
          properties: {
            ...optionalTabProperty,
            selector: { type: 'string' },
            text: { type: 'string' },
            url: { type: 'string' },
            state: { type: 'string', enum: ['loading', 'interactive', 'complete'] },
            timeoutMs: { type: 'number' },
          },
          additionalProperties: false,
        },
      ),
      tool(
        'browser_screenshot',
        'Capture the visible tab. Requires browser.read; returns base64 image data.',
        {
          type: 'object',
          properties: { ...optionalTabProperty, format: { type: 'string', enum: ['png', 'jpeg'] } },
          additionalProperties: false,
        },
      ),
      tool(
        'browser_upload_file',
        'Upload allowlisted files. Requires browser.upload, confirmation, and optional debugger permission.',
        {
          ...targetSchema(),
          properties: {
            ...targetSchema().properties,
            files: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 },
          },
          required: ['files'],
        },
      ),
      tool(
        'browser_get_downloads',
        'List recent downloads. Requires browser.download and optional downloads permission.',
        emptySchema,
      ),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const args = asRecord(request.params.arguments);
      if (request.params.name === 'conduit_status') return content(await client.health());
      const response = await callBrowserTool(client, request.params.name, args);
      return content(response, !response.success);
    } catch (error: unknown) {
      return content(
        { error: error instanceof Error ? error.message : 'Conduit tool failed.' },
        true,
      );
    }
  });

  return server;
}

export async function callBrowserTool(
  client: ConduitMcpClient,
  name: string,
  args: Record<string, unknown>,
): Promise<ResponseEnvelope> {
  const tabId = optionalNumber(args, 'tabId');
  const target = () => argumentTarget(args);
  switch (name) {
    case 'browser_list_tabs':
      return client.browser('browser.list_tabs');
    case 'browser_get_active_tab':
      return client.browser('browser.get_active_tab');
    case 'browser_open_tab':
      return client.browser(
        'browser.open_tab',
        optionalString(args, 'url') ? { url: optionalString(args, 'url') } : {},
      );
    case 'browser_close_tab':
      return client.browser('browser.close_tab', { tabId: requiredNumber(args, 'tabId') });
    case 'browser_focus_tab':
      return client.browser('browser.focus_tab', { tabId: requiredNumber(args, 'tabId') });
    case 'browser_navigate':
      return client.browser('browser.navigate', {
        ...(tabId === undefined ? {} : { tabId }),
        url: requiredString(args, 'url'),
      });
    case 'browser_go_back':
      return client.browser('browser.go_back', { tabId: requiredNumber(args, 'tabId') });
    case 'browser_go_forward':
      return client.browser('browser.go_forward', { tabId: requiredNumber(args, 'tabId') });
    case 'browser_reload':
      return client.browser('browser.reload', { tabId: requiredNumber(args, 'tabId') });
    case 'browser_snapshot':
      return client.browser('browser.snapshot', {
        ...(tabId === undefined ? {} : { tabId }),
        mode: optionalString(args, 'mode') ?? 'compact',
      });
    case 'browser_get_visible_text':
      return client.browser('browser.get_visible_text', tabId === undefined ? {} : { tabId });
    case 'browser_click':
      return client.browser('browser.click', {
        ...(tabId === undefined ? {} : { tabId }),
        target: target(),
      });
    case 'browser_type':
      return client.browser('browser.type', {
        ...(tabId === undefined ? {} : { tabId }),
        target: target(),
        text: requiredString(args, 'value'),
      });
    case 'browser_clear':
      return client.browser('browser.clear', {
        ...(tabId === undefined ? {} : { tabId }),
        target: target(),
      });
    case 'browser_select':
      return client.browser('browser.select', {
        ...(tabId === undefined ? {} : { tabId }),
        target: target(),
        values: requiredStrings(args, 'values'),
      });
    case 'browser_hover':
      return client.browser('browser.hover', {
        ...(tabId === undefined ? {} : { tabId }),
        target: target(),
      });
    case 'browser_scroll':
      return client.browser('browser.scroll', {
        ...(tabId === undefined ? {} : { tabId }),
        ...(hasTarget(args) ? { target: target() } : {}),
        deltaX: optionalNumber(args, 'deltaX') ?? 0,
        deltaY: optionalNumber(args, 'deltaY') ?? 0,
      });
    case 'browser_press_key':
      return client.browser('browser.press_key', {
        ...(tabId === undefined ? {} : { tabId }),
        key: requiredString(args, 'key'),
        modifiers: optionalStrings(args, 'modifiers') ?? [],
      });
    case 'browser_wait_for':
      return client.browser('browser.wait_for', {
        ...(tabId === undefined ? {} : { tabId }),
        ...copyOptional(args, ['selector', 'text', 'url', 'state']),
        timeoutMs: optionalNumber(args, 'timeoutMs') ?? 15_000,
      });
    case 'browser_screenshot':
      return client.browser('browser.screenshot', {
        ...(tabId === undefined ? {} : { tabId }),
        format: optionalString(args, 'format') ?? 'png',
      });
    case 'browser_upload_file':
      return client.browser('browser.upload_file', {
        ...(tabId === undefined ? {} : { tabId }),
        target: target(),
        files: requiredStrings(args, 'files'),
      });
    case 'browser_get_downloads':
      return client.browser('browser.get_downloads');
    default:
      throw new Error(`Unknown Conduit tool: ${name}`);
  }
}

function tool(name: string, description: string, inputSchema: Record<string, unknown>) {
  return { name, description, inputSchema };
}

function targetSchema() {
  return {
    type: 'object' as const,
    properties: { ...optionalTabProperty, ...targetProperties },
    additionalProperties: false,
  };
}

function argumentTarget(args: Record<string, unknown>): ElementTarget {
  const elementId = optionalString(args, 'elementId');
  if (elementId) return { elementId };
  const selector = optionalString(args, 'selector');
  if (selector) return { selector };
  const role = optionalString(args, 'role');
  const name = optionalString(args, 'name');
  if (role && name) return { role, name };
  const label = optionalString(args, 'label');
  if (label) return { label };
  const text = optionalString(args, 'text');
  if (text) return { text };
  throw new Error('An elementId, selector, role/name, label, or text target is required.');
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === 'string' ? (value[key] as string) : undefined;
}
function requiredString(value: Record<string, unknown>, key: string): string {
  const result = optionalString(value, key);
  if (result === undefined) throw new Error(`${key} is required.`);
  return result;
}
function optionalNumber(value: Record<string, unknown>, key: string): number | undefined {
  return typeof value[key] === 'number' ? (value[key] as number) : undefined;
}
function requiredNumber(value: Record<string, unknown>, key: string): number {
  const result = optionalNumber(value, key);
  if (result === undefined) throw new Error(`${key} is required.`);
  return result;
}
function optionalStrings(value: Record<string, unknown>, key: string): string[] | undefined {
  const candidate = value[key];
  return Array.isArray(candidate) && candidate.every((item) => typeof item === 'string')
    ? candidate
    : undefined;
}
function requiredStrings(value: Record<string, unknown>, key: string): string[] {
  const result = optionalStrings(value, key);
  if (!result) throw new Error(`${key} is required.`);
  return result;
}
function hasTarget(value: Record<string, unknown>): boolean {
  return ['elementId', 'selector', 'role', 'label', 'text'].some((key) => value[key] !== undefined);
}
function copyOptional(value: Record<string, unknown>, keys: string[]): Record<string, string> {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const item = optionalString(value, key);
      return item === undefined ? [] : [[key, item]];
    }),
  );
}
function content(value: unknown, isError = false) {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}
