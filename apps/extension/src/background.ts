import { BrowserActionError, ExtensionBrowserEngine } from '@conduit/browser-core';
import {
  BrowserRequestEnvelope,
  BrowserRequestEnvelopeSchema,
  createErrorResponse,
  createSuccessResponse,
} from '@conduit/protocol';

let daemonSocket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const browserEngine = new ExtensionBrowserEngine();

function connectDaemon(): void {
  if (daemonSocket) {
    return;
  }

  chrome.storage.local.get(
    ['daemonPort', 'daemonToken'],
    (result: { daemonPort?: number; daemonToken?: string }) => {
      const port = result.daemonPort ?? 9222;
      const token = result.daemonToken;

      if (!token) {
        console.log('No daemon token available. Waiting for configuration.');
        return;
      }

      daemonSocket = new WebSocket(`ws://127.0.0.1:${port}`);

      daemonSocket.onopen = () => {
        daemonSocket?.send(JSON.stringify({ type: 'auth', payload: { token } }));
      };

      daemonSocket.onmessage = (event) => {
        void handleDaemonMessage(event.data);
      };

      daemonSocket.onclose = () => {
        daemonSocket = null;
        setConnectionBadge(false);

        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
        }
        reconnectTimer = setTimeout(connectDaemon, 5_000);
      };

      daemonSocket.onerror = (error) => {
        console.error('Conduit daemon connection error', error);
      };
    },
  );
}

async function handleDaemonMessage(rawData: string): Promise<void> {
  const parsed = parseJson(rawData);
  if (!parsed.ok) {
    sendToDaemon(createErrorResponse('INVALID_REQUEST', 'Daemon message was not valid JSON.'));
    return;
  }

  if (isAuthSuccess(parsed.value)) {
    setConnectionBadge(true);
    return;
  }

  if (isAuthFailure(parsed.value)) {
    console.error('Authentication failed with Conduit daemon.');
    daemonSocket?.close();
    return;
  }

  const request = BrowserRequestEnvelopeSchema.safeParse(parsed.value);
  if (!request.success) {
    sendToDaemon(
      createErrorResponse('INVALID_REQUEST', 'Daemon request failed protocol validation.'),
    );
    return;
  }

  await executeBrowserRequest(request.data);
}

async function executeBrowserRequest(request: BrowserRequestEnvelope): Promise<void> {
  try {
    switch (request.type) {
      case 'browser.list_tabs': {
        const tabs = await browserEngine.listTabs();
        sendToDaemon(createSuccessResponse({ tabs }, request.id));
        return;
      }
      case 'browser.get_active_tab': {
        const tab = await browserEngine.getActiveTab();
        sendToDaemon(createSuccessResponse({ tab }, request.id));
        return;
      }
      case 'browser.open_tab': {
        const tab = await browserEngine.openTab(request.payload.url);
        sendToDaemon(createSuccessResponse({ tab }, request.id));
        return;
      }
      case 'browser.close_tab': {
        await browserEngine.closeTab(request.payload);
        sendToDaemon(createSuccessResponse({ closed: true }, request.id));
        return;
      }
      case 'browser.focus_tab': {
        await browserEngine.focusTab(request.payload);
        sendToDaemon(createSuccessResponse({ focused: true }, request.id));
        return;
      }
      case 'browser.navigate': {
        const tab = await browserEngine.navigate(request.payload, request.payload.url);
        sendToDaemon(createSuccessResponse({ tab }, request.id));
        return;
      }
      case 'browser.go_back': {
        await browserEngine.goBack(request.payload);
        sendToDaemon(createSuccessResponse({ navigated: true }, request.id));
        return;
      }
      case 'browser.go_forward': {
        await browserEngine.goForward(request.payload);
        sendToDaemon(createSuccessResponse({ navigated: true }, request.id));
        return;
      }
      case 'browser.reload': {
        await browserEngine.reload(request.payload);
        sendToDaemon(createSuccessResponse({ reloaded: true }, request.id));
        return;
      }
      case 'browser.snapshot': {
        const snapshot = await browserEngine.getSnapshot(request.payload, request.payload);
        sendToDaemon(createSuccessResponse({ snapshot }, request.id));
        return;
      }
      case 'browser.get_visible_text': {
        const text = await browserEngine.getVisibleText(request.payload);
        sendToDaemon(createSuccessResponse({ text }, request.id));
        return;
      }
      case 'browser.click': {
        await browserEngine.click(request.payload, request.payload);
        sendToDaemon(createSuccessResponse({ clicked: true }, request.id));
        return;
      }
      case 'browser.type': {
        await browserEngine.type(request.payload, request.payload);
        sendToDaemon(createSuccessResponse({ typed: true }, request.id));
        return;
      }
      case 'browser.screenshot': {
        const screenshot = await browserEngine.screenshot(request.payload, request.payload.format);
        sendToDaemon(createSuccessResponse({ screenshot }, request.id));
        return;
      }
    }
  } catch (error) {
    if (error instanceof BrowserActionError) {
      sendToDaemon(createErrorResponse(error.code, error.message, request.id));
      return;
    }

    const message = error instanceof Error ? error.message : 'Unexpected browser action failure.';
    sendToDaemon(createErrorResponse('INTERNAL_ERROR', message, request.id));
  }
}

function sendToDaemon(message: unknown): void {
  if (daemonSocket?.readyState === WebSocket.OPEN) {
    daemonSocket.send(JSON.stringify(message));
  }
}

function setConnectionBadge(connected: boolean): void {
  chrome.action.setBadgeText({ text: connected ? 'ON' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: connected ? '#107c41' : '#b42318' });
}

function parseJson(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}

function isAuthSuccess(value: unknown): value is { type: 'auth_success' } {
  return (
    typeof value === 'object' && value !== null && 'type' in value && value.type === 'auth_success'
  );
}

function isAuthFailure(
  value: unknown,
): value is { type: 'error'; error: { code: 'AUTHENTICATION_FAILED' } } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'error' &&
    'error' in value &&
    typeof value.error === 'object' &&
    value.error !== null &&
    'code' in value.error &&
    value.error.code === 'AUTHENTICATION_FAILED'
  );
}

connectDaemon();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || (!changes.daemonToken && !changes.daemonPort)) {
    return;
  }

  if (daemonSocket) {
    daemonSocket.close();
    return;
  }

  connectDaemon();
});
