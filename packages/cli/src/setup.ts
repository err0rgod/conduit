import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConfigStore, DEFAULT_CHROMIUM_EXTENSION_IDS } from '@conduit/config';
import { ConduitClient } from '@conduit/daemon-client';
import { getAppDataDir, LocalAuth } from '@conduit/security';
import { DaemonLifecycle, LifecycleStatus, daemonBaseUrl } from './lifecycle';
import { ServiceResult, UserService } from './service';
import { NativeHostInstaller, NativeHostStatus } from './native-host';

export interface SetupOptions {
  installService?: boolean;
  startDaemon?: boolean;
  installNativeHost?: boolean;
}

export interface UninstallOptions {
  purge?: boolean;
}

export interface SetupReport {
  configured: true;
  configPath: string;
  service?: ServiceResult;
  daemon?: LifecycleStatus;
  nativeHost?: NativeHostStatus;
  nextSteps: string[];
}

export interface UninstallReport {
  service: ServiceResult;
  daemon: LifecycleStatus;
  nativeHost: NativeHostStatus;
  dataRemoved: boolean;
  dataDirectory: string;
  packageRemovalCommand: string;
}

const EXTENSION_ARCHIVE_URL =
  'https://github.com/err0rgod/conduit-extension/releases/download/v0.1.3/conduit-extension-unpacked-v0.1.3.zip';

export interface SetupManagerOptions {
  configStore?: ConfigStore;
  auth?: LocalAuth;
  lifecycle?: Pick<DaemonLifecycle, 'start' | 'status' | 'stop'>;
  service?: Pick<UserService, 'install' | 'uninstall'>;
  dataDirectory?: string;
  client?: Pick<ConduitClient, 'startExtensionPairing'>;
}

export class SetupManager {
  private readonly configStore: ConfigStore;
  private readonly auth: LocalAuth;
  private readonly lifecycle: Pick<DaemonLifecycle, 'start' | 'status' | 'stop'>;
  private readonly service: Pick<UserService, 'install' | 'uninstall'>;
  private readonly dataDirectory: string;
  private readonly client: Pick<ConduitClient, 'startExtensionPairing'>;

  public constructor(options: SetupManagerOptions = {}) {
    this.configStore = options.configStore ?? new ConfigStore();
    this.auth = options.auth ?? new LocalAuth();
    this.lifecycle =
      options.lifecycle ?? new DaemonLifecycle({ configStore: this.configStore, auth: this.auth });
    this.service = options.service ?? new UserService();
    this.dataDirectory = path.resolve(options.dataDirectory ?? getAppDataDir());
    this.client =
      options.client ??
      new ConduitClient({ baseUrl: daemonBaseUrl(this.configStore.load()), auth: this.auth });
  }

  public async setup(options: SetupOptions = {}): Promise<SetupReport> {
    const installService = options.installService ?? true;
    const startDaemon = options.startDaemon ?? true;
    const installNativeHost = options.installNativeHost ?? true;
    const config = this.configStore.load();
    for (const extensionId of DEFAULT_CHROMIUM_EXTENSION_IDS) {
      if (!config.browser.chromiumExtensionIds.includes(extensionId)) {
        config.browser.chromiumExtensionIds.push(extensionId);
      }
    }
    this.configStore.save(config);
    this.auth.ensureToken();

    const service = installService ? this.service.install() : undefined;
    const daemon = startDaemon ? await this.lifecycle.start() : undefined;
    const nativeHost = installNativeHost
      ? new NativeHostInstaller({ configStore: this.configStore }).install()
      : undefined;
    return {
      configured: true,
      configPath: this.configStore.getPath(),
      ...(service ? { service } : {}),
      ...(daemon ? { daemon } : {}),
      ...(nativeHost ? { nativeHost } : {}),
      nextSteps: [
        `Download the verified Chrome/Brave extension archive: ${EXTENSION_ARCHIVE_URL}`,
        'Extract it, open chrome://extensions, enable Developer mode, choose Load unpacked, and select the folder containing manifest.json.',
        'Use Microsoft Edge Add-ons or Firefox Add-ons for those browsers.',
        'The unpacked development extension identity is already trusted.',
        'For a future store item, run conduit extension trust <store-extension-id> once.',
        'Restart the browser after installing the extension or changing its trusted ID.',
        'The extension will connect automatically.',
        'Agent Skill: https://github.com/err0rgod/skills/tree/main/conduit',
      ],
    };
  }

  public async uninstall(options: UninstallOptions = {}): Promise<UninstallReport> {
    const status = await this.lifecycle.status();
    const daemon =
      status.running && status.state
        ? await this.lifecycle.stop()
        : { running: false, message: 'No CLI-managed Conduit daemon was running.' };
    const service = this.service.uninstall();
    const nativeHost = new NativeHostInstaller({ configStore: this.configStore }).uninstall();
    let dataRemoved = false;
    if (options.purge) {
      assertSafeDataDirectory(this.dataDirectory);
      if (fs.existsSync(this.dataDirectory)) fs.rmSync(this.dataDirectory, { recursive: true });
      dataRemoved = true;
    }
    return {
      service,
      daemon,
      nativeHost,
      dataRemoved,
      dataDirectory: this.dataDirectory,
      packageRemovalCommand: 'npm uninstall --global conduit-browser',
    };
  }
}

function assertSafeDataDirectory(directory: string): void {
  const resolved = path.resolve(directory);
  const root = path.parse(resolved).root;
  if (
    resolved === root ||
    resolved === path.resolve(process.cwd()) ||
    resolved.split(path.sep).length < 3
  ) {
    throw new Error(`Refusing to recursively remove unsafe Conduit data path: ${resolved}`);
  }
}
