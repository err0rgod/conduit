import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmationManager } from '../src/confirmation';

afterEach(() => vi.useRealTimers());

describe('ConfirmationManager', () => {
  it('allows an approved confirmation exactly once for the matching operation', () => {
    const manager = new ConfirmationManager();
    const confirmation = manager.create('request-1', 'browser.click', 'high', 'Click purchase');
    expect(manager.consume(confirmation.id, 'browser.click')).toBe(false);
    expect(manager.respond(confirmation.id, true)).toBe(true);
    expect(manager.list()).toEqual([]);
    expect(manager.consume(confirmation.id, 'browser.type')).toBe(false);
    expect(manager.consume(confirmation.id, 'browser.click')).toBe(true);
    expect(manager.consume(confirmation.id, 'browser.click')).toBe(false);
  });

  it('expires pending confirmations', () => {
    vi.useFakeTimers();
    const manager = new ConfirmationManager(1_000);
    const confirmation = manager.create('request-1', 'browser.navigate', 'medium', 'Open domain');
    vi.advanceTimersByTime(1_001);
    expect(manager.respond(confirmation.id, true)).toBe(false);
    expect(manager.list()).toEqual([]);
  });
});
