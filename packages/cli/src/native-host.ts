import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ConfigStore } from '@conduit/config';
import { LocalAuth } from '@conduit/security';
import { resolveDistributionEntry } from './runtime-paths';

const EXPECTED_ORIGIN = 'chrome-extension://jkdlmcpkgkooilffjegfjmkanoelbmbl/';
const NATIVE_HOST_NAME = 'io.github.err0rgod.conduit';
const MAX_PAYLOAD_SIZE = 64 * 1024; // 64 KiB

export async function runNativeHost(origin: string): Promise<void> {
  try {
    if (origin !== EXPECTED_ORIGIN) {
      process.stderr.write(`Invalid origin: ${origin}\n`);
      process.exit(1);
    }

    const payload = await readNativeMessage(process.stdin);
    const request = JSON.parse(payload);

    if (request.type !== 'conduit.get-connection-settings' || request.protocolVersion !== 1) {
      process.stderr.write(`Invalid request type or protocol version\n`);
      process.exit(1);
    }

    const configStore = new ConfigStore();
    const config = configStore.load();
    const auth = new LocalAuth();

    // ensureToken gets or creates the token
    const token = auth.ensureToken();

    const response = {
      type: 'conduit.connection-settings',
      protocolVersion: 1,
      daemonPort: config.daemon.port,
      daemonToken: token,
    };

    const responsePayload = JSON.stringify(response);
    writeNativeMessage(process.stdout, responsePayload);
  } catch (err) {
    process.stderr.write(
      `Native host error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

function readNativeMessage(input: NodeJS.ReadStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);

    const onReadable = () => {
      let chunk;
      while ((chunk = input.read()) !== null) {
        buffer = Buffer.concat([buffer, chunk]);

        if (buffer.length >= 4) {
          const length = buffer.readUInt32LE(0);
          if (length > MAX_PAYLOAD_SIZE) {
            reject(new Error('Payload too large'));
            return;
          }
          if (buffer.length >= 4 + length) {
            const payload = buffer.subarray(4, 4 + length).toString('utf8');
            input.removeListener('readable', onReadable);
            resolve(payload);
            return;
          }
        }
      }
    };

    input.on('readable', onReadable);
    input.on('end', () => reject(new Error('Unexpected EOF')));
    input.on('error', reject);
  });
}

function writeNativeMessage(output: NodeJS.WriteStream, payload: string): void {
  const buffer = Buffer.from(payload, 'utf8');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32LE(buffer.length, 0);
  output.write(Buffer.concat([lengthBuffer, buffer]));
}

export interface NativeHostStatus {
  installed: boolean;
  message?: string;
}

export class NativeHostInstaller {
  public install(): NativeHostStatus {
    try {
      const { manifestDir, manifestPaths } = this.getPlatformPaths();
      const wrapperPath = this.createWrapper(manifestDir);

      const manifest = {
        name: NATIVE_HOST_NAME,
        description: 'Conduit local browser bridge',
        path: wrapperPath,
        type: 'stdio',
        allowed_origins: [EXPECTED_ORIGIN],
      };

      for (const manifestPath of manifestPaths) {
        fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
      }

      this.registerWindows(manifestPaths[0]);

      return { installed: true };
    } catch (err) {
      return { installed: false, message: String(err) };
    }
  }

  public uninstall(): NativeHostStatus {
    try {
      const { manifestPaths, manifestDir } = this.getPlatformPaths();
      for (const manifestPath of manifestPaths) {
        if (fs.existsSync(manifestPath)) {
          fs.unlinkSync(manifestPath);
        }
      }

      const wrapperPath = path.join(
        manifestDir,
        process.platform === 'win32' ? 'conduit-native-host.cmd' : 'conduit-native-host.sh',
      );
      if (fs.existsSync(wrapperPath)) {
        fs.unlinkSync(wrapperPath);
      }

      this.unregisterWindows();

      return { installed: false };
    } catch (err) {
      return { installed: true, message: String(err) };
    }
  }

  public status(): NativeHostStatus {
    const { manifestPaths } = this.getPlatformPaths();
    const installed = manifestPaths.some((p) => fs.existsSync(p));
    return { installed };
  }

  private getPlatformPaths(): { manifestDir: string; manifestPaths: string[] } {
    const homedir = os.homedir();
    const platform = process.platform;

    if (platform === 'win32') {
      const manifestDir = path.join(homedir, 'AppData', 'Local', 'Conduit', 'NativeHost');
      const manifestPath = path.join(manifestDir, `${NATIVE_HOST_NAME}.json`);
      return { manifestDir, manifestPaths: [manifestPath] };
    }

    if (platform === 'darwin') {
      const manifestDir = path.join(
        homedir,
        'Library',
        'Application Support',
        'Conduit',
        'NativeHost',
      );
      return {
        manifestDir,
        manifestPaths: [
          path.join(
            homedir,
            'Library',
            'Application Support',
            'Google',
            'Chrome',
            'NativeMessagingHosts',
            `${NATIVE_HOST_NAME}.json`,
          ),
          path.join(
            homedir,
            'Library',
            'Application Support',
            'Microsoft Edge',
            'NativeMessagingHosts',
            `${NATIVE_HOST_NAME}.json`,
          ),
          path.join(
            homedir,
            'Library',
            'Application Support',
            'Chromium',
            'NativeMessagingHosts',
            `${NATIVE_HOST_NAME}.json`,
          ),
        ],
      };
    }

    // linux
    const manifestDir = path.join(homedir, '.config', 'conduit', 'native-host');
    return {
      manifestDir,
      manifestPaths: [
        path.join(
          homedir,
          '.config',
          'google-chrome',
          'NativeMessagingHosts',
          `${NATIVE_HOST_NAME}.json`,
        ),
        path.join(
          homedir,
          '.config',
          'microsoft-edge',
          'NativeMessagingHosts',
          `${NATIVE_HOST_NAME}.json`,
        ),
        path.join(
          homedir,
          '.config',
          'chromium',
          'NativeMessagingHosts',
          `${NATIVE_HOST_NAME}.json`,
        ),
      ],
    };
  }

  private createWrapper(manifestDir: string): string {
    fs.mkdirSync(manifestDir, { recursive: true });

    // Resolve cli path properly, fallback to relative path if not packaged
    let cliEntry = resolveDistributionEntry('cli.cjs');
    if (!cliEntry) {
      cliEntry = path.resolve(__dirname, '..', '..', '..', 'packages', 'cli', 'dist', 'index.js');
    }
    const nodeExec = process.execPath;

    if (process.platform === 'win32') {
      const wrapperPath = path.join(manifestDir, 'conduit-native-host.cmd');
      const content = `@echo off\r\n"${nodeExec}" "${cliEntry}" extension native-host %*`;
      fs.writeFileSync(wrapperPath, content);
      return wrapperPath;
    } else {
      const wrapperPath = path.join(manifestDir, 'conduit-native-host.sh');
      const content = `#!/bin/sh\nexec "${nodeExec}" "${cliEntry}" extension native-host "$@"`;
      fs.writeFileSync(wrapperPath, content, { mode: 0o755 });
      return wrapperPath;
    }
  }

  private registerWindows(manifestPath: string): void {
    if (process.platform !== 'win32') return;
    const { execSync } = require('node:child_process');
    const keys = [
      `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
      `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
    ];
    for (const key of keys) {
      try {
        execSync(`reg add "${key}" /ve /t REG_SZ /d "${manifestPath}" /f`, { stdio: 'ignore' });
      } catch (e) {
        // ignore
      }
    }
  }

  private unregisterWindows(): void {
    if (process.platform !== 'win32') return;
    const { execSync } = require('node:child_process');
    const keys = [
      `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
      `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
    ];
    for (const key of keys) {
      try {
        execSync(`reg delete "${key}" /f`, { stdio: 'ignore' });
      } catch (e) {
        // ignore
      }
    }
  }
}
