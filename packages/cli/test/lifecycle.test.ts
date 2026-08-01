import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '@conduit/config';
import { LocalAuth } from '@conduit/security';
import { DaemonLifecycle } from '../src/lifecycle';

describe('DaemonLifecycle', () => {
  let directory: string;
  let lifecycle: DaemonLifecycle;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-lifecycle-'));
    const configStore = new ConfigStore({ configPath: path.join(directory, 'config.json') });
    configStore.save({ daemon: { port: await availablePort() } });
    lifecycle = new DaemonLifecycle({
      configStore,
      statePath: path.join(directory, 'daemon-state.json'),
      logPath: path.join(directory, 'daemon.log'),
      daemonEntryPath: path.join(__dirname, 'fixtures', 'daemon.js'),
      startupTimeoutMs: 10_000,
      auth: new LocalAuth({ configPath: path.join(directory, 'auth.json') }),
    });
  });

  afterEach(async () => {
    try {
      const status = await lifecycle.status();
      if (status.running) await lifecycle.stop();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('starts, verifies, records, and gracefully stops a detached daemon', async () => {
    const started = await lifecycle.start();
    expect(started.running).toBe(true);
    expect(started.state?.instanceId).toBe(started.health?.instanceId);
    expect(fs.existsSync(lifecycle.getStatePath())).toBe(true);
    expect((await lifecycle.status()).message).toBe('Conduit daemon is running.');
    expect(lifecycle.readLogs()).toEqual([
      expect.stringContaining(`fixture daemon ${started.state?.instanceId}`),
    ]);

    const stopped = await lifecycle.stop();
    expect(stopped.running).toBe(false);
    expect(fs.existsSync(lifecycle.getStatePath())).toBe(false);
  });

  it('does not signal a PID when daemon identity cannot be verified', async () => {
    const started = await lifecycle.start();
    if (!started.state) throw new Error('Expected managed daemon state.');
    const mismatchedState = { ...started.state, instanceId: crypto.randomUUID() };
    fs.writeFileSync(lifecycle.getStatePath(), JSON.stringify(mismatchedState));
    await expect(lifecycle.stop()).rejects.toThrowError('Daemon identity could not be verified');
    fs.writeFileSync(lifecycle.getStatePath(), JSON.stringify(started.state));
  });
});

function availablePort(): Promise<number> {
  const server = http.createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}
