import { describe, expect, it } from 'vitest';
import { BrowserRequestEnvelopeSchema, createEnvelopeBase } from '@conduit/protocol';
import { SecurityPolicy, classifyHost, isPrivateNetworkHost } from '../src/policy';

const LOCAL_URLS = [
  'http://localhost/',
  'http://LOCALHOST/',
  'http://localhost./',
  'http://localhost%2e/',
  'http://foo.localhost/',
  'http://a.b.localhost./',
  'http://127.0.0.1/',
  'http://127.0.0.1./',
  'http://127.1.2.3/',
  'http://127.255.255.254/',
  'http://127.1/',
  'http://2130706433/',
  'http://0x7f.1/',
  'http://017700000001/',
  'http://0177.0.0.1/',
  'http://0.0.0.0/',
  'http://0.1.2.3/',
  'http://[::1]/',
  'http://[0:0:0:0:0:0:0:1]/',
  'http://[::]/',
  'http://[::ffff:127.0.0.1]/',
  'http://[::ffff:7f00:1]/',
  'http://[::ffff:0.0.0.0]/',
  'http://[::127.0.0.1]/',
  'http://[64:ff9b::7f00:1]/',
  'http://[2002:7f00:1::]/',
];

const PRIVATE_URLS = [
  'http://10.0.0.1/',
  'http://172.16.0.1/',
  'http://172.31.255.255/',
  'http://192.168.1.1/',
  'http://192.168.1/',
  'http://169.254.169.254/latest/meta-data/',
  'http://169.254.0.1/',
  'http://100.64.0.1/',
  'http://100.127.255.255/',
  'http://[::ffff:10.0.0.1]/',
  'http://[::ffff:a00:1]/',
  'http://[::ffff:169.254.169.254]/',
  'http://[64:ff9b::a00:1]/',
  'http://[fc00::1]/',
  'http://[fd12:3456::1]/',
  'http://[fe80::1]/',
  'http://[febf::1]/',
  'http://[ff02::1]/',
  'http://printer.local/',
  'http://printer.local./',
  'http://metadata.google.internal/',
  'http://router/',
  'http://3232235777/',
  'http://0xa9fea9fe/',
];

const PUBLIC_URLS = [
  'https://example.com/',
  'https://example.com./',
  'http://8.8.8.8/',
  'http://100.63.255.255/',
  'http://100.128.0.1/',
  'http://172.15.0.1/',
  'http://172.32.0.1/',
  'http://169.253.1.1/',
  'http://[2606:4700:4700::1111]/',
  'http://[::ffff:8.8.8.8]/',
  'http://[fbff::1]/',
  'http://[fec0::1]/',
  'https://notlocalhost.com/',
  'https://localhost.example.com/',
];

function hostOf(url: string): string {
  return new URL(url).hostname;
}

function browserRequest(type: string, payload: unknown = {}) {
  return BrowserRequestEnvelopeSchema.parse({ ...createEnvelopeBase(), type, payload });
}

describe('localhost and private-network guard', () => {
  it.each(LOCAL_URLS)('classifies %s as localhost and denies it by default', (url) => {
    expect(classifyHost(hostOf(url))).toBe('localhost');
    expect(new SecurityPolicy({ domainMode: 'allow-all' }).evaluateUrl(url).outcome).toBe('deny');
    // Even an explicit allowlist entry must not defeat the guard.
    const allowlisted = new SecurityPolicy({
      domainMode: 'allowlist',
      allowedDomains: [hostOf(url)],
    });
    expect(allowlisted.evaluateUrl(url).outcome).toBe('deny');
  });

  it.each(PRIVATE_URLS)('classifies %s as private network and denies it by default', (url) => {
    expect(classifyHost(hostOf(url))).toBe('private');
    expect(isPrivateNetworkHost(hostOf(url))).toBe(true);
    expect(new SecurityPolicy({ domainMode: 'allow-all' }).evaluateUrl(url).outcome).toBe('deny');
    // allowLocalhost must not open private ranges.
    const localhostOnly = new SecurityPolicy({ domainMode: 'allow-all', allowLocalhost: true });
    expect(localhostOnly.evaluateUrl(url).outcome).toBe('deny');
  });

  it.each(PUBLIC_URLS)('classifies %s as public', (url) => {
    expect(classifyHost(hostOf(url))).toBe('public');
    expect(new SecurityPolicy({ domainMode: 'allow-all' }).evaluateUrl(url).outcome).toBe('allow');
  });

  it.each(LOCAL_URLS)('allowLocalhost opens %s', (url) => {
    const policy = new SecurityPolicy({ domainMode: 'allow-all', allowLocalhost: true });
    expect(policy.evaluateUrl(url).outcome).toBe('allow');
  });

  it.each(PRIVATE_URLS)('allowPrivateNetworks opens %s', (url) => {
    const policy = new SecurityPolicy({ domainMode: 'allow-all', allowPrivateNetworks: true });
    expect(policy.evaluateUrl(url).outcome).toBe('allow');
  });

  it('canonicalises raw non-URL-normalised input the same way', () => {
    expect(classifyHost('2130706433')).toBe('localhost');
    expect(classifyHost('0x7f.1')).toBe('localhost');
    expect(classifyHost('[::1]')).toBe('localhost');
    expect(classifyHost('::1')).toBe('localhost');
    expect(classifyHost('127.0.0.1.')).toBe('localhost');
    expect(classifyHost('')).toBe('public');
  });

  it('keeps blocked-domain precedence when localhost is permitted', () => {
    const policy = new SecurityPolicy({
      domainMode: 'allow-all',
      allowLocalhost: true,
      blockedDomains: ['localhost', '*.localhost'],
    });
    expect(policy.evaluateUrl('http://localhost./').outcome).toBe('deny');
    expect(policy.evaluateUrl('http://app.localhost/').outcome).toBe('deny');
  });
});

describe('unknown current URL fails closed', () => {
  const policy = new SecurityPolicy({
    permissions: ['browser.read', 'browser.interact', 'browser.forms', 'browser.navigate'],
    domainMode: 'allow-all',
  });
  const pageOperations: Array<[string, unknown]> = [
    ['browser.snapshot', {}],
    ['browser.get_visible_text', {}],
    ['browser.screenshot', {}],
    ['browser.scroll', { tabId: 1, deltaY: 100 }],
    ['browser.click', { target: { elementId: 'e1' } }],
    ['browser.type', { target: { elementId: 'e1' }, text: 'x' }],
    ['browser.go_back', { tabId: 1 }],
    ['browser.reload', { tabId: 1 }],
  ];

  it.each(pageOperations)('denies %s when the URL is unknown', (type, payload) => {
    const decision = policy.authorize(browserRequest(type, payload));
    expect(decision.outcome).toBe('deny');
    if (decision.outcome === 'deny') {
      expect(decision.urlUnknown).toBe(true);
      expect(decision.reason).toMatch(/list tabs or navigate/iu);
    }
  });

  it.each(pageOperations)('allows %s once a public URL is known', (type, payload) => {
    expect(policy.authorize(browserRequest(type, payload), 'https://example.com/').outcome).toBe(
      'allow',
    );
  });

  it('applies the guard to a known current URL on a local address', () => {
    const decision = policy.authorize(
      browserRequest('browser.snapshot'),
      'http://[::ffff:127.0.0.1]:8080/admin',
    );
    expect(decision.outcome).toBe('deny');
  });

  it('keeps tab-level operations usable without a URL', () => {
    expect(policy.authorize(browserRequest('browser.list_tabs')).outcome).toBe('allow');
    expect(policy.authorize(browserRequest('browser.get_active_tab')).outcome).toBe('allow');
    expect(policy.authorize(browserRequest('browser.focus_tab', { tabId: 1 })).outcome).toBe(
      'allow',
    );
  });

  it('evaluates only the destination for navigate, regardless of current URL', () => {
    const navigate = browserRequest('browser.navigate', { url: 'https://example.com' });
    expect(policy.authorize(navigate).outcome).toBe('allow');
    expect(policy.authorize(navigate, 'chrome://newtab/').outcome).toBe('allow');
    const metadata = browserRequest('browser.navigate', { url: 'http://169.254.169.254/' });
    expect(policy.authorize(metadata, 'https://example.com/').outcome).toBe('deny');
  });

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'chrome://settings/'])(
    'rejects %s for navigate and open_tab in every domain mode',
    (url) => {
      for (const domainMode of ['allow-all', 'blocklist', 'allowlist', 'ask'] as const) {
        const strict = new SecurityPolicy({
          permissions: ['browser.navigate'],
          domainMode,
          allowedDomains: ['example.com'],
        });
        expect(strict.authorize(browserRequest('browser.navigate', { url })).outcome).toBe('deny');
        expect(strict.authorize(browserRequest('browser.open_tab', { url })).outcome).toBe('deny');
      }
    },
  );
});
