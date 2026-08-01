import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConfigStore } from '@conduit/config';
import { ConduitClient } from '@conduit/daemon-client';
import { getAppDataDir, LocalAuth } from '@conduit/security';
import { resolveExtensionPath } from './doctor';
import { DaemonLifecycle, LifecycleStatus, daemonBaseUrl } from './lifecycle';
import { ServiceResult, UserService } from './service';

export interface SetupOptions {
  installService?: boolean;
  startDaemon?: boolean;
}

export interface UninstallOptions {
  purge?: boolean;
}

export interface SetupReport {
  configured: true;
  configPath: string;
  extensionPath: string;
  service?: ServiceResult;
  daemon?: LifecycleStatus;
  extensionPairing?: { code: string; expiresAt: number };
  nextSteps: string[];
}

export interface UninstallReport {
  service: ServiceResult;
  daemon: LifecycleStatus;
  dataRemoved: boolean;
  dataDirectory: string;
  packageRemovalCommand: string;
}

export interface SetupManagerOptions {
  configStore?: ConfigStore;
  auth?: LocalAuth;
  lifecycle?: Pick<DaemonLifecycle, 'start' | 'status' | 'stop'>;
  service?: Pick<UserService, 'install' | 'uninstall'>;
  dataDirectory?: string;
  extensionPath?: string;
  client?: Pick<ConduitClient, 'startExtensionPairing'>;
}

export class SetupManager {
  private readonly configStore: ConfigStore;
  private readonly auth: LocalAuth;
  private readonly lifecycle: Pick<DaemonLifecycle, 'start' | 'status' | 'stop'>;
  private readonly service: Pick<UserService, 'install' | 'uninstall'>;
  private readonly dataDirectory: string;
  private readonly extensionPath?: string;
  private readonly client: Pick<ConduitClient, 'startExtensionPairing'>;

  public constructor(options: SetupManagerOptions = {}) {
    this.configStore = options.configStore ?? new ConfigStore();
    this.auth = options.auth ?? new LocalAuth();
    this.lifecycle =
      options.lifecycle ?? new DaemonLifecycle({ configStore: this.configStore, auth: this.auth });
    this.service = options.service ?? new UserService();
    this.dataDirectory = path.resolve(options.dataDirectory ?? getAppDataDir());
    this.extensionPath = options.extensionPath;
    this.client =
      options.client ??
      new ConduitClient({ baseUrl: daemonBaseUrl(this.configStore.load()), auth: this.auth });
  }

  public async setup(options: SetupOptions = {}): Promise<SetupReport> {
    const installService = options.installService ?? true;
    const startDaemon = options.startDaemon ?? true;
    this.configStore.save(this.configStore.load());
    this.auth.ensureToken();
    const extensionPath = this.extensionPath ?? resolveExtensionPath();
    const service = installService ? this.service.install() : undefined;
    const daemon = startDaemon ? await this.lifecycle.start() : undefined;
    const extensionPairing = startDaemon ? await this.client.startExtensionPairing() : undefined;
    return {
      configured: true,
      configPath: this.configStore.getPath(),
      extensionPath,
      ...(service ? { service } : {}),
      ...(daemon ? { daemon } : {}),
      ...(extensionPairing ? { extensionPairing } : {}),
      nextSteps: [
        'Open chrome://extensions or edge://extensions.',
        'Enable Developer mode and choose Load unpacked.',
        `Select ${extensionPath}.`,
        'Enter the short-lived pairing code from this report in the Conduit extension.',
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
    let dataRemoved = false;
    if (options.purge) {
      assertSafeDataDirectory(this.dataDirectory);
      if (fs.existsSync(this.dataDirectory)) fs.rmSync(this.dataDirectory, { recursive: true });
      dataRemoved = true;
    }
    return {
      service,
      daemon,
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
