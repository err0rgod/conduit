import {
  BrowserTarget,
  BrowserTab,
  ClickAction,
  ElementTarget,
  ErrorCode,
  PageSnapshot,
  ScreenshotResult,
  SnapshotRequest,
  TabTarget,
  TypeAction,
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
  screenshot(target: BrowserTarget, format?: 'png' | 'jpeg'): Promise<ScreenshotResult>;
}

interface InPageActionResult {
  ok: boolean;
  code?: ErrorCode;
  message?: string;
}

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
    return this.runInTab(tabId, buildSnapshotInPage, [
      request.mode,
      request.elementId ?? null,
      MAX_SNAPSHOT_ELEMENTS,
      MAX_VISIBLE_TEXT_LENGTH,
    ]);
  }

  public async getVisibleText(target: BrowserTarget): Promise<string> {
    const tabId = await this.resolveTabId(target);
    return this.runInTab(tabId, () => document.body?.innerText ?? '', []);
  }

  public async click(target: BrowserTarget, action: ClickAction): Promise<void> {
    const tabId = await this.resolveTabId(target);
    const result = await this.runInTab(tabId, clickInPage, [action.target]);
    assertActionResult(result);
  }

  public async type(target: BrowserTarget, action: TypeAction): Promise<void> {
    const tabId = await this.resolveTabId(target);
    const result = await this.runInTab(tabId, typeInPage, [action.target, action.text]);
    assertActionResult(result);
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
    if (!first) {
      throw new BrowserActionError(
        'FRAME_NOT_FOUND',
        'The target tab did not return a script result.',
      );
    }
    return first.result as Result;
  }
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
