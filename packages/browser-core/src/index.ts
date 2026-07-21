import {
  TabTarget,
  ElementTarget,
  NavigateAction,
  ClickAction,
  TypeAction,
  SnapshotRequest,
} from '@conduit/protocol';

export interface BrowserTab {
  id: number;
  url: string;
  title: string;
  active: boolean;
}

export interface BrowserActionEngine {
  listTabs(): Promise<BrowserTab[]>;
  getActiveTab(): Promise<BrowserTab | null>;
  openTab(url?: string): Promise<BrowserTab>;
  closeTab(target: TabTarget): Promise<void>;
  focusTab(target: TabTarget): Promise<void>;
  navigate(target: TabTarget, action: NavigateAction): Promise<void>;
  goBack(target: TabTarget): Promise<void>;
  goForward(target: TabTarget): Promise<void>;
  reload(target: TabTarget): Promise<void>;

  getSnapshot(target: TabTarget, request: SnapshotRequest): Promise<any>;
  click(target: TabTarget, action: ClickAction): Promise<void>;
  type(target: TabTarget, action: TypeAction): Promise<void>;
  screenshot(target: TabTarget): Promise<string>; // Base64 image
}

export class ExtensionBrowserEngine implements BrowserActionEngine {
  async listTabs(): Promise<BrowserTab[]> {
    const tabs = await chrome.tabs.query({});
    return tabs.map((t) => ({
      id: t.id!,
      url: t.url || '',
      title: t.title || '',
      active: t.active,
    }));
  }

  async getActiveTab(): Promise<BrowserTab | null> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return null;
    const t = tabs[0];
    return {
      id: t.id!,
      url: t.url || '',
      title: t.title || '',
      active: t.active,
    };
  }

  async openTab(url?: string): Promise<BrowserTab> {
    const t = await chrome.tabs.create({ url });
    return {
      id: t.id!,
      url: t.url || '',
      title: t.title || '',
      active: t.active,
    };
  }

  async closeTab(target: TabTarget): Promise<void> {
    await chrome.tabs.remove(target.tabId);
  }

  async focusTab(target: TabTarget): Promise<void> {
    await chrome.tabs.update(target.tabId, { active: true });
  }

  async navigate(target: TabTarget, action: NavigateAction): Promise<void> {
    await chrome.tabs.update(target.tabId, { url: action.url });
  }

  async goBack(target: TabTarget): Promise<void> {
    await chrome.tabs.goBack(target.tabId);
  }

  async goForward(target: TabTarget): Promise<void> {
    await chrome.tabs.goForward(target.tabId);
  }

  async reload(target: TabTarget): Promise<void> {
    await chrome.tabs.reload(target.tabId);
  }

  async getSnapshot(target: TabTarget, request: SnapshotRequest): Promise<any> {
    // This requires executing a content script to extract DOM information.
    // For the vertical slice, returning basic info.
    const results = await chrome.scripting.executeScript({
      target: { tabId: target.tabId },
      func: () => {
        return {
          title: document.title,
          url: document.URL,
          visibleText: document.body.innerText.substring(0, 500), // Compact text
        };
      },
    });
    return results[0].result;
  }

  async click(target: TabTarget, action: ClickAction): Promise<void> {
    const targetEl = action.target as any;

    await chrome.scripting.executeScript({
      target: { tabId: target.tabId },
      func: (selector: string) => {
        const el = document.querySelector(selector) as HTMLElement;
        if (el) el.click();
      },
      args: [targetEl.selector || 'body'], // Fallback to body or provided selector
    });
  }

  async type(target: TabTarget, action: TypeAction): Promise<void> {
    const targetEl = action.target as any;

    await chrome.scripting.executeScript({
      target: { tabId: target.tabId },
      func: (selector: string, text: string) => {
        const el = document.querySelector(selector) as HTMLInputElement;
        if (el) {
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      },
      args: [targetEl.selector || 'body', action.text],
    });
  }

  async screenshot(target: TabTarget): Promise<string> {
    const dataUrl = await chrome.tabs.captureVisibleTab();
    return dataUrl.split(',')[1]; // Return base64 part
  }
}
