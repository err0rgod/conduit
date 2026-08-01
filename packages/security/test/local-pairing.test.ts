import { describe, expect, it } from 'vitest';
import { LocalPairingManager } from '../src/local-pairing';

describe('LocalPairingManager', () => {
  it('creates a high-entropy, one-use code', () => {
    const manager = new LocalPairingManager();
    const pairing = manager.create(1_000);
    expect(pairing.code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/u);
    expect(manager.consume(pairing.code, 2_000)).toBe(true);
    expect(manager.consume(pairing.code, 2_001)).toBe(false);
  });

  it('rejects expired and unknown codes', () => {
    const manager = new LocalPairingManager(1_000);
    const pairing = manager.create(1_000);
    expect(manager.consume(pairing.code, 2_000)).toBe(false);
    expect(manager.consume('AAAAAAAAAAAA', 1_500)).toBe(false);
  });
});
