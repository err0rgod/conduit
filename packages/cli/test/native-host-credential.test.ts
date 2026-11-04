import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { ConduitConfigSchema } from '@conduit/config';
import { LocalAuth } from '@conduit/security';
import {
  EXPECTED_EXTENSION_ORIGIN,
  encodeNativeMessage,
  readNativeMessage,
  runNativeHost,
} from '../src/native-host';

describe('native host credential separation', () => {
  let directory: string | undefined;
  afterEach(() => {
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('hands the extension only the extension credential, never the agent token', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-native-cred-'));
    const auth = new LocalAuth({
      configPath: path.join(directory, 'auth.json'),
      onWarning: () => undefined,
    });
    const chunks: Buffer[] = [];
    const output = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    await runNativeHost(EXPECTED_EXTENSION_ORIGIN, {
      input: Readable.from([
        encodeNativeMessage({ type: 'conduit.get-connection-settings', protocolVersion: 1 }),
      ]),
      output,
      configStore: { load: () => ConduitConfigSchema.parse({}) },
      auth,
    });
    const response = (await readNativeMessage(Readable.from(chunks))) as { daemonToken: string };
    expect(response.daemonToken).toBe(auth.ensureExtensionCredential());
    expect(response.daemonToken).not.toBe(auth.ensureToken());
    expect(JSON.stringify(response)).not.toContain(auth.ensureToken());
  });
});
