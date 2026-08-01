import {
  BrowserTarget,
  BrowserTab,
  ClickAction,
  ElementTarget,
  ErrorCode,
  PageSnapshot,
  ScreenshotResult,
  ScrollAction,
  SelectAction,
  SnapshotRequest,
  TabTarget,
  TypeAction,
  UploadFileAction,
  WaitForAction,
  PressKeyAction,
} from '@conduit/protocol';

export class BrowserActionError extends Error {
  public readonly code: ErrorCode;

  public constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'BrowserActionError';
    this.code = code;
  }
}

export interface BrowserActionEngine {
  listTabs(): Promise<BrowserTab[]>;
  getActiveTab(): Promise<BrowserTab | null>;
  openTab(url?: string): Promise<BrowserTab>;
  closeTab(target: TabTarget): Promise<void>;
  focusTab(target: TabTarget): Promise<void>;
  navigate(target: BrowserTarget, url: string): Promise<BrowserTab>;
  goBack(target: TabTarget): Promise<void>;
  goForward(target: TabTarget): Promise<void>;
  reload(target: TabTarget): Promise<void>;
  getSnapshot(target: BrowserTarget, request: SnapshotRequest): Promise<PageSnapshot>;
  getVisibleText(target: BrowserTarget): Promise<string>;
  click(target: BrowserTarget, action: ClickAction): Promise<void>;
  type(target: BrowserTarget, action: TypeAction): Promise<void>;
  clear(target: BrowserTarget, action: { target: ElementTarget }): Promise<void>;
  select(target: BrowserTarget, action: SelectAction): Promise<void>;
  hover(target: BrowserTarget, action: { target: ElementTarget }): Promise<void>;
  scroll(target: BrowserTarget, action: ScrollAction): Promise<void>;
  pressKey(target: BrowserTarget, action: PressKeyAction): Promise<void>;
  waitFor(target: BrowserTarget, action: WaitForAction): Promise<void>;
  screenshot(target: BrowserTarget, format?: 'png' | 'jpeg'): Promise<ScreenshotResult>;
  uploadFile(target: BrowserTarget, action: UploadFileAction): Promise<void>;
  getDownloads(): Promise<Array<{ id: number; filename: string; url: string; state: string }>>;
}

interface InPageActionResult {
  ok: boolean;
  code?: ErrorCode;
  message?: string;
}

type PageActionRequest =
  | {
      operation: 'snapshot';
      mode: SnapshotRequest['mode'];
      focusedElementId: string | null;
      maxElements: number;
      maxVisibleTextLength: number;
    }
  | { operation: 'visible-text' }
  | { operation: 'click'; target: ElementTarget }
  | { operation: 'type'; target: ElementTarget; text: string }
  | { operation: 'clear'; target: ElementTarget }
  | { operation: 'select'; target: ElementTarget; values: string[] }
  | { operation: 'scroll'; target?: ElementTarget; deltaX: number; deltaY: number }
  | { operation: 'wait'; action: WaitForAction }
  | { operation: 'bounds'; target: ElementTarget }
  | { operation: 'selector'; target: ElementTarget };

const MAX_SNAPSHOT_ELEMENTS = 200;
const MAX_VISIBLE_TEXT_LENGTH = 20_000;

export class ExtensionBrowserEngine implements BrowserActionEngine {
  public async listTabs(): Promise<BrowserTab[]> {
    const tabs = await chrome.tabs.query({});
    return tabs.map(toBrowserTab);
  }

  public async getActiveTab(): Promise<BrowserTab | null> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] ? toBrowserTab(tabs[0]) : null;
  }

  public async openTab(url?: string): Promise<BrowserTab> {
    const tab = await chrome.tabs.create({ ...(url ? { url } : {}) });
    return toBrowserTab(tab);
  }

  public async closeTab(target: TabTarget): Promise<void> {
    await chrome.tabs.remove(target.tabId);
  }

  public async focusTab(target: TabTarget): Promise<void> {
    await chrome.tabs.update(target.tabId, { active: true });
  }

  public async navigate(target: BrowserTarget, url: string): Promise<BrowserTab> {
    const tabId = await this.resolveTabId(target);
    const tab = await chrome.tabs.update(tabId, { url });
    return toBrowserTab(tab);
  }

  public async goBack(target: TabTarget): Promise<void> {
    await chrome.tabs.goBack(target.tabId);
  }

  public async goForward(target: TabTarget): Promise<void> {
    await chrome.tabs.goForward(target.tabId);
  }

  public async reload(target: TabTarget): Promise<void> {
    await chrome.tabs.reload(target.tabId);
  }

  public async getSnapshot(target: BrowserTarget, request: SnapshotRequest): Promise<PageSnapshot> {
    const tabId = await this.resolveTabId(target);
    const result = await this.runInTab(tabId, executePageActionInPage, [
      {
        operation: 'snapshot',
        mode: request.mode,
        focusedElementId: request.elementId ?? null,
        maxElements: MAX_SNAPSHOT_ELEMENTS,
        maxVisibleTextLength: MAX_VISIBLE_TEXT_LENGTH,
      },
    ]);
    return result as PageSnapshot;
  }

  public async getVisibleText(target: BrowserTarget): Promise<string> {
    const tabId = await this.resolveTabId(target);
    const result = await this.runInTab(tabId, executePageActionInPage, [
      { operation: 'visible-text' },
    ]);
    return result as string;
  }

  public async click(target: BrowserTarget, action: ClickAction): Promise<void> {
    const tabId = await this.resolveTabId(target);
    const result = await this.runInTab(tabId, executePageActionInPage, [
      { operation: 'click', target: action.target },
    ]);
    assertActionResult(result as InPageActionResult);
  }

  public async type(target: BrowserTarget, action: TypeAction): Promise<void> {
    const tabId = await this.resolveTabId(target);
    const result = await this.runInTab(tabId, executePageActionInPage, [
      { operation: 'type', target: action.target, text: action.text },
    ]);
    assertActionResult(result as InPageActionResult);
  }

  public async clear(target: BrowserTarget, action: { target: ElementTarget }): Promise<void> {
    const tabId = await this.resolveTabId(target);
    const result = await this.runInTab(tabId, executePageActionInPage, [
      { operation: 'clear', target: action.target },
    ]);
    assertActionResult(result as InPageActionResult);
  }

  public async select(target: BrowserTarget, action: SelectAction): Promise<void> {
    const tabId = await this.resolveTabId(target);
    const result = await this.runInTab(tabId, executePageActionInPage, [
      { operation: 'select', target: action.target, values: action.values },
    ]);
    assertActionResult(result as InPageActionResult);
  }

  public async scroll(target: BrowserTarget, action: ScrollAction): Promise<void> {
    const tabId = await this.resolveTabId(target);
    const result = await this.runInTab(tabId, executePageActionInPage, [
      {
        operation: 'scroll',
        ...(action.target ? { target: action.target } : {}),
        deltaX: action.deltaX,
        deltaY: action.deltaY,
      },
    ]);
    assertActionResult(result as InPageActionResult);
  }

  public async waitFor(target: BrowserTarget, action: WaitForAction): Promise<void> {
    const tabId = await this.resolveTabId(target);
    const result = await this.runInTab(tabId, executePageActionInPage, [
      { operation: 'wait', action },
    ]);
    assertActionResult(result as InPageActionResult);
  }

  public async hover(target: BrowserTarget, action: { target: ElementTarget }): Promise<void> {
    await requireOptionalPermission('debugger');
    const tabId = await this.resolveTabId(target);
    const bounds = await this.runInTab(tabId, executePageActionInPage, [
      { operation: 'bounds', target: action.target },
    ]);
    if (!isPoint(bounds)) {
      assertActionResult(bounds as InPageActionResult);
      return;
    }
    await withDebugger(tabId, async (debuggee) => {
      await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: bounds.x,
        y: bounds.y,
      });
    });
  }

  public async pressKey(target: BrowserTarget, action: PressKeyAction): Promise<void> {
    await requireOptionalPermission('debugger');
    const tabId = await this.resolveTabId(target);
    const modifiers = action.modifiers.reduce(
      (mask, modifier) => mask | ({ Alt: 1, Control: 2, Meta: 4, Shift: 8 }[modifier] ?? 0),
      0,
    );
    await withDebugger(tabId, async (debuggee) => {
      await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: action.key,
        text: action.key.length === 1 ? action.key : undefined,
        modifiers,
      });
      await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: action.key,
        modifiers,
      });
    });
  }

  public async screenshot(
    target: BrowserTarget,
    format: 'png' | 'jpeg' = 'png',
  ): Promise<ScreenshotResult> {
    const tabId = await this.resolveTabId(target);
    const tab = await chrome.tabs.update(tabId, { active: true });
    const windowId = tab.windowId;

    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format });
    return normalizeDataUrl(dataUrl);
  }

  public async uploadFile(target: BrowserTarget, action: UploadFileAction): Promise<void> {
    await requireOptionalPermission('debugger');
    const tabId = await this.resolveTabId(target);
    const selector = await this.runInTab(tabId, executePageActionInPage, [
      { operation: 'selector', target: action.target },
    ]);
    if (typeof selector !== 'string') {
      assertActionResult(selector as InPageActionResult);
      return;
    }
    await withDebugger(tabId, async (debuggee) => {
      const documentResult = await chrome.debugger.sendCommand(debuggee, 'DOM.getDocument', {
        depth: -1,
        pierce: true,
      });
      const rootNodeId = nestedNumber(documentResult, 'root', 'nodeId');
      if (rootNodeId === undefined) {
        throw new BrowserActionError('FRAME_NOT_FOUND', 'Debugger did not return a document root.');
      }
      const queryResult = await chrome.debugger.sendCommand(debuggee, 'DOM.querySelector', {
        nodeId: rootNodeId,
        selector,
      });
      const nodeId = objectNumber(queryResult, 'nodeId');
      if (!nodeId) throw new BrowserActionError('ELEMENT_NOT_FOUND', 'Upload input was not found.');
      await chrome.debugger.sendCommand(debuggee, 'DOM.setFileInputFiles', {
        nodeId,
        files: action.files,
      });
    });
  }

  public async getDownloads(): Promise<
    Array<{ id: number; filename: string; url: string; state: string }>
  > {
    await requireOptionalPermission('downloads');
    const downloads = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 100 });
    return downloads.map((download) => ({
      id: download.id,
      filename: download.filename,
      url: download.url,
      state: download.state,
    }));
  }

  private async resolveTabId(target: BrowserTarget): Promise<number> {
    if (target.tabId !== undefined) {
      return target.tabId;
    }

    const active = await this.getActiveTab();
    if (!active) {
      throw new BrowserActionError('TAB_NOT_FOUND', 'No active browser tab is available.');
    }

    return active.id;
  }

  private async runInTab<Args extends unknown[], Result>(
    tabId: number,
    func: (...args: Args) => Result,
    args: Args,
  ): Promise<Result> {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func,
      args,
    });
    const first = results[0];
    if (!first || first.result === null || first.result === undefined) {
      throw new BrowserActionError(
        'FRAME_NOT_FOUND',
        'The target tab did not return a script result.',
      );
    }
    return first.result as Result;
  }
}

async function requireOptionalPermission(permission: 'debugger' | 'downloads'): Promise<void> {
  const granted = await chrome.permissions.contains({ permissions: [permission] });
  if (!granted) {
    throw new BrowserActionError(
      'PERMISSION_DENIED',
      `The optional Chromium ${permission} permission has not been granted.`,
    );
  }
}

async function withDebugger(
  tabId: number,
  action: (debuggee: chrome.debugger.Debuggee) => Promise<void>,
): Promise<void> {
  const debuggee = { tabId };
  await chrome.debugger.attach(debuggee, '1.3');
  try {
    await action(debuggee);
  } finally {
    await chrome.debugger.detach(debuggee).catch(() => undefined);
  }
}

function isPoint(value: unknown): value is { x: number; y: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'x' in value &&
    typeof value.x === 'number' &&
    'y' in value &&
    typeof value.y === 'number'
  );
}

function objectNumber(value: object, key: string): number | undefined {
  if (key in value) {
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === 'number' ? candidate : undefined;
  }
  return undefined;
}

function nestedNumber(value: object, parent: string, key: string): number | undefined {
  if (!(parent in value)) return undefined;
  const nested = (value as Record<string, unknown>)[parent];
  return typeof nested === 'object' && nested !== null ? objectNumber(nested, key) : undefined;
}

export function normalizeDataUrl(dataUrl: string): ScreenshotResult {
  const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/u.exec(dataUrl);
  if (!match) {
    throw new BrowserActionError(
      'INTERNAL_ERROR',
      'Browser returned an unsupported screenshot format.',
    );
  }

  return {
    mimeType: match[1] as 'image/png' | 'image/jpeg',
    data: match[2],
  };
}

function toBrowserTab(tab: chrome.tabs.Tab): BrowserTab {
  if (tab.id === undefined) {
    throw new BrowserActionError('TAB_NOT_FOUND', 'Browser tab did not include an ID.');
  }

  return {
    id: tab.id,
    url: tab.url ?? '',
    title: tab.title ?? '',
    active: tab.active,
    ...(tab.windowId !== undefined ? { windowId: tab.windowId } : {}),
  };
}

function assertActionResult(result: InPageActionResult): void {
  if (result.ok) {
    return;
  }

  throw new BrowserActionError(
    result.code ?? 'INTERNAL_ERROR',
    result.message ?? 'Browser action failed.',
  );
}

// chrome.scripting serializes only the supplied function. Keep every browser-page
// dependency inside this function so the real execution environment has no module closure.
async function executePageActionInPage(
  request: PageActionRequest,
): Promise<PageSnapshot | string | InPageActionResult | { x: number; y: number }> {
  const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim();
  const disabled = (element: Element) =>
    ('disabled' in element && Boolean((element as { disabled?: boolean }).disabled)) ||
    element.getAttribute('aria-disabled') === 'true';
  const visible = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      style.opacity !== '0'
    );
  };
  const roleOf = (element: Element): string | undefined => {
    const explicit = element.getAttribute('role');
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'summary') return 'button';
    if (tag === 'input') {
      const type = (element as HTMLInputElement).type;
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button') return 'button';
      return 'textbox';
    }
    return undefined;
  };
  const nameOf = (element: Element): string => {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return normalize(ariaLabel);
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const value = labelledBy
        .split(/\s+/u)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');
      if (value.trim()) return normalize(value);
    }
    if (
      (element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement) &&
      element.labels?.length
    ) {
      return normalize(
        Array.from(element.labels)
          .map((label) => label.textContent ?? '')
          .join(' '),
      );
    }
    const title = element.getAttribute('title');
    if (title) return normalize(title);
    return normalize((element as HTMLElement).innerText || element.textContent || '');
  };
  const safeValue = (element: Element): string | undefined => {
    if (element instanceof HTMLInputElement) {
      return element.type === 'password' ? '[redacted]' : element.value.slice(0, 200);
    }
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      return element.value.slice(0, 200);
    }
    return undefined;
  };
  const escapeIdentifier = (value: string) =>
    typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape(value)
      : value.replace(/[^a-zA-Z0-9_-]/gu, '\\$&');
  const pathOf = (element: Element): string => {
    const path: string[] = [];
    let current: Element | null = element;
    while (current && current !== document.body) {
      const tag = current.tagName.toLowerCase();
      if (current.id) {
        path.unshift(`${tag}#${escapeIdentifier(current.id)}`);
        break;
      }
      const parent: Element | null = current.parentElement;
      if (!parent) {
        path.unshift(tag);
        break;
      }
      const siblings = Array.from(parent.children).filter(
        (sibling) => sibling.tagName === current?.tagName,
      );
      path.unshift(`${tag}:nth-of-type(${siblings.indexOf(current) + 1})`);
      current = parent;
    }
    return path.join(' > ');
  };
  const resolve = (target: ElementTarget): Element | null => {
    if ('elementId' in target) {
      return document.querySelector(`[data-conduit-ref="${target.elementId}"]`);
    }
    if ('selector' in target) return document.querySelector(target.selector);
    if ('xpath' in target) {
      return document.evaluate(target.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE)
        .singleNodeValue as Element | null;
    }
    if ('coordinates' in target) {
      return document.elementFromPoint(target.coordinates.x, target.coordinates.y);
    }
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('a,button,input,select,textarea,[role],[tabindex]'),
    );
    if ('role' in target) {
      return (
        candidates.find(
          (element) => roleOf(element) === target.role && nameOf(element) === target.name,
        ) ?? null
      );
    }
    if ('label' in target)
      return candidates.find((element) => nameOf(element) === target.label) ?? null;
    return (
      candidates.find(
        (element) => normalize(element.innerText || element.textContent || '') === target.text,
      ) ?? null
    );
  };

  if (request.operation === 'visible-text') return document.body?.innerText ?? '';

  if (request.operation === 'click') {
    const element = resolve(request.target);
    if (!element)
      return {
        ok: false,
        code: 'ELEMENT_NOT_FOUND',
        message: 'Could not resolve the target element.',
      };
    if (!(element instanceof HTMLElement) || disabled(element)) {
      return {
        ok: false,
        code: 'ELEMENT_NOT_INTERACTABLE',
        message: 'Target element is not clickable.',
      };
    }
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.focus();
    element.click();
    return { ok: true };
  }

  if (request.operation === 'type') {
    const element = resolve(request.target);
    if (!element)
      return {
        ok: false,
        code: 'ELEMENT_NOT_FOUND',
        message: 'Could not resolve the target element.',
      };
    if (disabled(element))
      return {
        ok: false,
        code: 'ELEMENT_NOT_INTERACTABLE',
        message: 'Target element is disabled.',
      };
    element.scrollIntoView({ block: 'center', inline: 'center' });
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.focus();
      const prototype =
        element instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, request.text);
      else element.value = request.text;
      element.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: request.text }),
      );
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    if (element instanceof HTMLElement && element.isContentEditable) {
      element.focus();
      element.textContent = request.text;
      element.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: request.text }),
      );
      return { ok: true };
    }
    return {
      ok: false,
      code: 'ELEMENT_NOT_INTERACTABLE',
      message: 'Target element does not accept text input.',
    };
  }

  if (request.operation === 'clear') {
    const element = resolve(request.target);
    if (!element) {
      return {
        ok: false,
        code: 'ELEMENT_NOT_FOUND',
        message: 'Could not resolve the target element.',
      };
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const prototype =
        element instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, '');
      else element.value = '';
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    if (element instanceof HTMLElement && element.isContentEditable) {
      element.textContent = '';
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }));
      return { ok: true };
    }
    return {
      ok: false,
      code: 'ELEMENT_NOT_INTERACTABLE',
      message: 'Target element cannot be cleared.',
    };
  }

  if (request.operation === 'select') {
    const element = resolve(request.target);
    if (!(element instanceof HTMLSelectElement)) {
      return {
        ok: false,
        code: element ? 'ELEMENT_NOT_INTERACTABLE' : 'ELEMENT_NOT_FOUND',
        message: 'Target is not a select element.',
      };
    }
    const wanted = new Set(request.values);
    let matched = false;
    for (const option of Array.from(element.options)) {
      option.selected = wanted.has(option.value) || wanted.has(option.label);
      matched ||= option.selected;
    }
    if (!matched)
      return { ok: false, code: 'ELEMENT_NOT_FOUND', message: 'No requested option was found.' };
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  }

  if (request.operation === 'scroll') {
    const element = request.target ? resolve(request.target) : null;
    if (request.target && !element) {
      return {
        ok: false,
        code: 'ELEMENT_NOT_FOUND',
        message: 'Could not resolve the scroll target.',
      };
    }
    if (element instanceof HTMLElement) {
      element.scrollBy({ left: request.deltaX, top: request.deltaY, behavior: 'instant' });
    } else {
      window.scrollBy({ left: request.deltaX, top: request.deltaY, behavior: 'instant' });
    }
    return { ok: true };
  }

  if (request.operation === 'bounds' || request.operation === 'selector') {
    const element = resolve(request.target);
    if (!(element instanceof HTMLElement)) {
      return {
        ok: false,
        code: 'ELEMENT_NOT_FOUND',
        message: 'Could not resolve the target element.',
      };
    }
    if (request.operation === 'selector') return pathOf(element);
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  if (request.operation === 'wait') {
    const started = Date.now();
    const conditionMet = () => {
      try {
        return (
          (!request.action.selector || document.querySelector(request.action.selector) !== null) &&
          (!request.action.text ||
            (document.body?.innerText ?? '').includes(request.action.text)) &&
          (!request.action.url || document.URL.includes(request.action.url)) &&
          (!request.action.state || document.readyState === request.action.state)
        );
      } catch {
        return false;
      }
    };
    while (!conditionMet()) {
      if (Date.now() - started >= request.action.timeoutMs) {
        return {
          ok: false,
          code: 'ACTION_TIMEOUT',
          message: 'Page condition was not met before timeout.',
        };
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    return { ok: true };
  }

  const selector = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    'summary',
    '[role]',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
  ].join(',');
  let candidates: HTMLElement[];
  if (request.focusedElementId) {
    candidates = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-conduit-ref="${request.focusedElementId}"]`),
    );
  } else {
    document
      .querySelectorAll('[data-conduit-ref]')
      .forEach((element) => element.removeAttribute('data-conduit-ref'));
    candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
  }
  const elements =
    request.mode === 'visible-text'
      ? []
      : candidates
          .filter(visible)
          .slice(0, request.maxElements)
          .map((element, index) => {
            const elementId = request.focusedElementId ?? `e${index + 1}`;
            element.setAttribute('data-conduit-ref', elementId);
            const rect = element.getBoundingClientRect();
            const input = element instanceof HTMLInputElement ? element : null;
            const anchor = element instanceof HTMLAnchorElement ? element : null;
            return {
              elementId,
              role: roleOf(element),
              name: nameOf(element),
              text: normalize(element.innerText || element.textContent || ''),
              tagName: element.tagName.toLowerCase(),
              inputType: input?.type,
              value: safeValue(element),
              disabled: disabled(element),
              selected: element instanceof HTMLOptionElement ? element.selected : undefined,
              href: anchor?.href,
              selector: pathOf(element),
              bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            };
          });
  return {
    url: document.URL,
    title: document.title,
    loadingState: document.readyState,
    mode: request.mode,
    capturedAt: Date.now(),
    visibleText: normalize(document.body?.innerText ?? '').slice(0, request.maxVisibleTextLength),
    elements,
    frames: Array.from(document.querySelectorAll('iframe')).map((frame) => ({
      url: frame.src,
      title: frame.title || undefined,
    })),
  };
}

function buildSnapshotInPage(
  mode: SnapshotRequest['mode'],
  focusedElementId: string | null,
  maxElements: number,
  maxVisibleTextLength: number,
): PageSnapshot {
  const interactiveSelector = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    'summary',
    '[role]',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
  ].join(',');

  document.querySelectorAll('[data-conduit-ref]').forEach((element) => {
    element.removeAttribute('data-conduit-ref');
  });

  const candidates =
    focusedElementId === null
      ? Array.from(document.querySelectorAll<HTMLElement>(interactiveSelector))
      : Array.from(
          document.querySelectorAll<HTMLElement>(`[data-conduit-ref="${focusedElementId}"]`),
        );

  const elements = candidates
    .filter(isVisibleElement)
    .slice(0, maxElements)
    .map((element, index) => {
      const elementId = focusedElementId ?? `e${index + 1}`;
      element.setAttribute('data-conduit-ref', elementId);
      const rect = element.getBoundingClientRect();
      const tagName = element.tagName.toLowerCase();
      const input = element instanceof HTMLInputElement ? element : null;
      const anchor = element instanceof HTMLAnchorElement ? element : null;

      return {
        elementId,
        role: inferRole(element),
        name: accessibleName(element),
        text: normalizeText(element.innerText || element.textContent || ''),
        tagName,
        inputType: input?.type,
        value: safeElementValue(element),
        disabled: isDisabled(element),
        selected: element instanceof HTMLOptionElement ? element.selected : undefined,
        href: anchor?.href,
        selector: cssPath(element),
        bounds: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
      };
    });

  return {
    url: document.URL,
    title: document.title,
    loadingState: document.readyState,
    mode,
    capturedAt: Date.now(),
    visibleText: normalizeText(document.body?.innerText ?? '').slice(0, maxVisibleTextLength),
    elements,
    frames: Array.from(document.querySelectorAll('iframe')).map((frame) => ({
      url: frame.src,
      title: frame.title || undefined,
    })),
  };
}

function clickInPage(target: ElementTarget): InPageActionResult {
  const element = resolveElement(target);
  if (!element) {
    return {
      ok: false,
      code: 'ELEMENT_NOT_FOUND',
      message: 'Could not resolve the target element.',
    };
  }

  if (!(element instanceof HTMLElement) || isDisabled(element)) {
    return {
      ok: false,
      code: 'ELEMENT_NOT_INTERACTABLE',
      message: 'Target element is not clickable.',
    };
  }

  element.scrollIntoView({ block: 'center', inline: 'center' });
  element.focus();
  element.click();
  return { ok: true };
}

function typeInPage(target: ElementTarget, text: string): InPageActionResult {
  const element = resolveElement(target);
  if (!element) {
    return {
      ok: false,
      code: 'ELEMENT_NOT_FOUND',
      message: 'Could not resolve the target element.',
    };
  }

  if (isDisabled(element)) {
    return { ok: false, code: 'ELEMENT_NOT_INTERACTABLE', message: 'Target element is disabled.' };
  }

  element.scrollIntoView({ block: 'center', inline: 'center' });

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.focus();
    element.value = text;
    element.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
    );
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    element.focus();
    element.textContent = text;
    element.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
    );
    return { ok: true };
  }

  return {
    ok: false,
    code: 'ELEMENT_NOT_INTERACTABLE',
    message: 'Target element does not accept text input.',
  };
}

function resolveElement(target: ElementTarget): Element | null {
  if ('elementId' in target) {
    return document.querySelector(`[data-conduit-ref="${target.elementId}"]`);
  }

  if ('selector' in target) {
    return document.querySelector(target.selector);
  }

  if ('xpath' in target) {
    return document.evaluate(target.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE)
      .singleNodeValue as Element | null;
  }

  if ('coordinates' in target) {
    return document.elementFromPoint(target.coordinates.x, target.coordinates.y);
  }

  const elements = Array.from(
    document.querySelectorAll<HTMLElement>('a,button,input,select,textarea,[role],[tabindex]'),
  );

  if ('role' in target) {
    return (
      elements.find(
        (element) => inferRole(element) === target.role && accessibleName(element) === target.name,
      ) ?? null
    );
  }

  if ('label' in target) {
    return elements.find((element) => accessibleName(element) === target.label) ?? null;
  }

  return (
    elements.find(
      (element) => normalizeText(element.innerText || element.textContent || '') === target.text,
    ) ?? null
  );
}

function isVisibleElement(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    style.opacity !== '0'
  );
}

function inferRole(element: Element): string | undefined {
  const explicit = element.getAttribute('role');
  if (explicit) {
    return explicit;
  }

  const tagName = element.tagName.toLowerCase();
  if (tagName === 'a') return 'link';
  if (tagName === 'button') return 'button';
  if (tagName === 'select') return 'combobox';
  if (tagName === 'textarea') return 'textbox';
  if (tagName === 'summary') return 'button';
  if (tagName === 'input') {
    const type = (element as HTMLInputElement).type;
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'submit' || type === 'button') return 'button';
    return 'textbox';
  }
  return undefined;
}

function accessibleName(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    return normalizeText(ariaLabel);
  }

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelText = labelledBy
      .split(/\s+/u)
      .map((id) => document.getElementById(id)?.innerText ?? '')
      .join(' ');
    if (labelText.trim()) {
      return normalizeText(labelText);
    }
  }

  if (element instanceof HTMLInputElement && element.labels?.length) {
    return normalizeText(
      Array.from(element.labels)
        .map((label) => label.innerText)
        .join(' '),
    );
  }

  const title = element.getAttribute('title');
  if (title) {
    return normalizeText(title);
  }

  return normalizeText((element as HTMLElement).innerText || element.textContent || '');
}

function safeElementValue(element: Element): string | undefined {
  if (element instanceof HTMLInputElement) {
    return element.type === 'password' ? '[redacted]' : element.value.slice(0, 200);
  }

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return element.value.slice(0, 200);
  }

  return undefined;
}

function isDisabled(element: Element): boolean {
  return (
    ('disabled' in element && Boolean((element as { disabled?: boolean }).disabled)) ||
    element.getAttribute('aria-disabled') === 'true'
  );
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function cssPath(element: Element): string {
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
    const tag = current.tagName.toLowerCase();
    const id = current.id ? `#${escapeCssIdent(current.id)}` : '';
    if (id) {
      path.unshift(`${tag}${id}`);
      break;
    }

    const parent: Element | null = current.parentElement;
    if (!parent) {
      path.unshift(tag);
      break;
    }

    const siblings = Array.from(parent.children).filter(
      (sibling): sibling is Element => sibling.tagName === current?.tagName,
    );
    const index = siblings.indexOf(current) + 1;
    path.unshift(`${tag}:nth-of-type(${index})`);
    current = parent;
  }

  return path.join(' > ');
}

function escapeCssIdent(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/gu, '\\$&');
}
