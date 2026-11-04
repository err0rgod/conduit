import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmationManager, fingerprintRequest } from '../src/confirmation';

afterEach(() => vi.useRealTimers());

const navigateA = fingerprintRequest({
  type: 'browser.navigate',
  payload: { url: 'https://a.example/' },
  tabId: 1,
});

function approved(manager: ConfirmationManager, fingerprint: string): string {
  const confirmation = manager.create(
    'request-1',
    'browser.navigate',
    'medium',
    'Open domain',
    fingerprint,
    'a.example',
  );
  expect(manager.respond(confirmation.id, true)).toBe(true);
  return confirmation.id;
}

describe('fingerprintRequest', () => {
  it('is stable across key order and ignores undefined fields', () => {
    const one = fingerprintRequest({
      type: 'browser.type',
      payload: { a: 1, b: { c: 2, d: [1] } },
    });
    const two = fingerprintRequest({
      type: 'browser.type',
      payload: { b: { d: [1], c: 2 }, a: 1, ignored: undefined },
    });
    expect(one).toBe(two);
    expect(one).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('changes when the operation, tab, page, or any payload value changes', () => {
    const base = { type: 'browser.click', payload: { target: { elementId: 'e1' } }, tabId: 1 };
    const fingerprints = new Set([
      fingerprintRequest(base),
      fingerprintRequest({ ...base, type: 'browser.hover' }),
      fingerprintRequest({ ...base, tabId: 2 }),
      fingerprintRequest({ ...base, currentUrl: 'https://a.example/' }),
      fingerprintRequest({ ...base, payload: { target: { elementId: 'e2' } } }),
    ]);
    expect(fingerprints.size).toBe(5);
  });
});

describe('ConfirmationManager', () => {
  it('allows an approved confirmation exactly once for the exact request', () => {
    const manager = new ConfirmationManager();
    const confirmation = manager.create(
      'request-1',
      'browser.click',
      'high',
      'Click purchase',
      navigateA,
    );
    expect(manager.consume(confirmation.id, navigateA)).toBe('invalid');
    expect(manager.respond(confirmation.id, true)).toBe(true);
    expect(manager.list()).toEqual([]);
    expect(manager.consume(confirmation.id, navigateA)).toBe('consumed');
    expect(manager.consume(confirmation.id, navigateA)).toBe('invalid');
  });

  it('rejects a different URL, payload, or tab without spending the approval', () => {
    const manager = new ConfirmationManager();
    const id = approved(manager, navigateA);
    const differentUrl = fingerprintRequest({
      type: 'browser.navigate',
      payload: { url: 'https://evil.example/' },
      tabId: 1,
    });
    const differentPayload = fingerprintRequest({
      type: 'browser.navigate',
      payload: { url: 'https://a.example/', extra: true },
      tabId: 1,
    });
    const differentTab = fingerprintRequest({
      type: 'browser.navigate',
      payload: { url: 'https://a.example/' },
      tabId: 2,
    });
    expect(manager.consume(id, differentUrl)).toBe('mismatch');
    expect(manager.consume(id, differentPayload)).toBe('mismatch');
    expect(manager.consume(id, differentTab)).toBe('mismatch');
    expect(manager.consume(id, navigateA)).toBe('consumed');
    expect(manager.consume(id, navigateA)).toBe('invalid');
  });

  it('never consumes a denied or unknown confirmation', () => {
    const manager = new ConfirmationManager();
    const confirmation = manager.create('r', 'browser.navigate', 'medium', 's', navigateA);
    expect(manager.respond(confirmation.id, false)).toBe(true);
    expect(manager.consume(confirmation.id, navigateA)).toBe('invalid');
    expect(manager.consume('missing', navigateA)).toBe('invalid');
  });

  it('expires pending and approved confirmations', () => {
    vi.useFakeTimers();
    const manager = new ConfirmationManager(1_000);
    const pending = manager.create('r', 'browser.navigate', 'medium', 's', navigateA);
    const id = approved(manager, navigateA);
    vi.advanceTimersByTime(1_001);
    expect(manager.respond(pending.id, true)).toBe(false);
    expect(manager.consume(id, navigateA)).toBe('invalid');
    expect(manager.list()).toEqual([]);
  });
});
