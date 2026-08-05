import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, ConfigStore, ConduitConfigSchema } from '../src/index';

describe('Conduit configuration', () => {
  let directory: string;
  let configPath: string;
  let store: ConfigStore;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-config-'));
    configPath = path.join(directory, 'config.json');
    store = new ConfigStore({ configPath });
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  it('provides complete safe defaults without creating a file', () => {
    const config = store.load();
    expect(config.daemon.bindAddress).toBe('127.0.0.1');
    expect(config.remote.enabled).toBe(false);
    expect(config.security.permissions).toEqual([
      'browser.read',
      'browser.navigate',
      'browser.interact',
      'browser.forms',
      'browser.download',
    ]);
    expect(config.security.domainMode).toBe('blocklist');
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('round-trips a validated versioned configuration', () => {
    const saved = store.save({
      version: 1,
      daemon: { port: 9333 },
      security: { allowedDomains: ['example.com', '*.example.org'] },
    });
    expect(saved.daemon.port).toBe(9333);
    expect(store.load()).toEqual(saved);
  });

  it('rejects public binding without both explicit remote mode and TLS', () => {
    const result = ConduitConfigSchema.safeParse({ daemon: { bindAddress: '0.0.0.0' } });
    expect(result.success).toBe(false);
    expect(() =>
      store.save({
        daemon: { bindAddress: '0.0.0.0' },
        remote: { enabled: true, tlsKeyPath: 'key.pem', tlsCertificatePath: 'cert.pem' },
      }),
    ).not.toThrow();
  });

  it('updates known values and validates their resulting types', () => {
    store.save({});
    expect(store.update('daemon.port', '9444').daemon.port).toBe(9444);
    expect(
      store.update('security.allowedDomains', '["example.com"]').security.allowedDomains,
    ).toEqual(['example.com']);
    expect(() => store.update('daemon.port', 'invalid')).toThrowError(ConfigError);
    expect(() => store.update('unknown.value', '1')).toThrowError(ConfigError);
  });

  it('fails closed for malformed or unknown configuration', () => {
    fs.writeFileSync(configPath, '{broken');
    expect(() => store.load()).toThrowError('Configuration file is not valid JSON');
    fs.writeFileSync(configPath, JSON.stringify({ surprise: true }));
    expect(() => store.load()).toThrowError('Configuration failed validation');
  });

  it('supports an explicit configuration path for isolated profiles', () => {
    const previous = process.env.CONDUIT_CONFIG_PATH;
    process.env.CONDUIT_CONFIG_PATH = configPath;
    try {
      expect(new ConfigStore().getPath()).toBe(configPath);
    } finally {
      if (previous === undefined) delete process.env.CONDUIT_CONFIG_PATH;
      else process.env.CONDUIT_CONFIG_PATH = previous;
    }
  });
});
