import { describe, expect, it } from 'vitest';
import { SecurityPolicy, isPrivateNetworkHost, matchesDomain } from '../src/policy';
import { BrowserRequestEnvelopeSchema, createEnvelopeBase } from '@conduit/protocol';

function request(type: 'browser.list_tabs' | 'browser.navigate', payload: unknown = {}) {
  return BrowserRequestEnvelopeSchema.parse({ ...createEnvelopeBase(), type, payload });
}

describe('SecurityPolicy', () => {
  it('denies permissions that were not explicitly granted', () => {
    const policy = new SecurityPolicy();
    expect(
      policy.authorize(request('browser.navigate', { url: 'https://example.com' })).outcome,
    ).toBe('deny');
  });

  it('allows explicitly granted read operations', () => {
    expect(new SecurityPolicy().authorize(request('browser.list_tabs')).outcome).toBe('allow');
  });

  it('asks before first use of an unknown public domain', () => {
    const policy = new SecurityPolicy({ permissions: ['browser.navigate'] });
    expect(
      policy.authorize(request('browser.navigate', { url: 'https://example.com' })).outcome,
    ).toBe('confirm');
  });

  it('enforces allowlists, blocklists, localhost, and private network defaults', () => {
    const policy = new SecurityPolicy({
      permissions: ['browser.navigate'],
      domainMode: 'allowlist',
      allowedDomains: ['example.com', '*.trusted.test'],
      blockedDomains: ['blocked.example.com'],
    });
    expect(policy.evaluateUrl('https://example.com').outcome).toBe('allow');
    expect(policy.evaluateUrl('https://api.trusted.test').outcome).toBe('allow');
    expect(policy.evaluateUrl('https://blocked.example.com').outcome).toBe('deny');
    expect(policy.evaluateUrl('http://127.0.0.1').outcome).toBe('deny');
    expect(policy.evaluateUrl('http://192.168.1.10').outcome).toBe('deny');
  });
});

describe('domain matching', () => {
  it('does not let wildcard patterns match the apex domain', () => {
    expect(matchesDomain('api.example.com', '*.example.com')).toBe(true);
    expect(matchesDomain('example.com', '*.example.com')).toBe(false);
  });

  it('recognizes private IPv4 ranges without treating public addresses as private', () => {
    expect(isPrivateNetworkHost('10.2.3.4')).toBe(true);
    expect(isPrivateNetworkHost('172.31.4.5')).toBe(true);
    expect(isPrivateNetworkHost('8.8.8.8')).toBe(false);
  });
});
