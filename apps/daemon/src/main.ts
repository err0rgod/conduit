import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConfigStore, ConduitConfig } from '@conduit/config';
import { AuditLogger, SecurityPolicy, getAppDataDir } from '@conduit/security';
import { Daemon, DaemonOptions } from './index';

export function daemonOptionsFromConfig(config: ConduitConfig, instanceId?: string): DaemonOptions {
  const tls =
    config.remote.tlsKeyPath && config.remote.tlsCertificatePath
      ? {
          key: fs.readFileSync(path.resolve(config.remote.tlsKeyPath)),
          cert: fs.readFileSync(path.resolve(config.remote.tlsCertificatePath)),
        }
      : undefined;
  return {
    requestTimeoutMs: config.daemon.requestTimeoutMs,
    maxBodyBytes: config.daemon.maximumMessageBytes,
    sessionTimeoutMs: config.daemon.sessionTimeoutMs,
    bindAddress: config.daemon.bindAddress,
    remoteEnabled: config.remote.enabled,
    remoteSessionTimeoutMs: config.remote.sessionTimeoutMs,
    ...(tls ? { tls } : {}),
    ...(instanceId ? { instanceId } : {}),
    policy: new SecurityPolicy({
      permissions: config.security.permissions,
      domainMode: config.security.domainMode,
      allowedDomains: config.security.allowedDomains,
      blockedDomains: config.security.blockedDomains,
      allowLocalhost: config.security.allowLocalhost,
      allowPrivateNetworks: config.security.allowPrivateNetworks,
    }),
    uploadAllowlist: config.security.uploadAllowlist,
    maxUploadFileBytes: config.security.maximumUploadFileBytes,
    audit: new AuditLogger({
      filePath: path.join(getAppDataDir(), 'audit.jsonl'),
      maxBytes: config.logging.maximumAuditBytes,
    }),
  };
}

export async function runDaemon(): Promise<void> {
  const configStore = new ConfigStore({
    ...(process.env.CONDUIT_CONFIG_PATH
      ? { configPath: path.resolve(process.env.CONDUIT_CONFIG_PATH) }
      : {}),
  });
  const config = configStore.load();
  let stopping = false;
  let daemon: Daemon;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    void daemon
      .stop()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        process.stderr.write(
          `${error instanceof Error ? error.message : 'Daemon shutdown failed.'}\n`,
        );
        process.exit(1);
      });
  };
  daemon = new Daemon({
    ...daemonOptionsFromConfig(config, process.env.CONDUIT_INSTANCE_ID),
    shutdownHandler: shutdown,
  });
  const port = await daemon.start(config.daemon.port);
  process.stdout.write(
    `Conduit daemon started on ${config.daemon.bindAddress}:${port} using ${configStore.getPath()}\n`,
  );
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  void runDaemon().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Daemon startup failed.'}\n`);
    process.exitCode = 1;
  });
}
