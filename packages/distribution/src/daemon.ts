import { runDaemon } from '../../../apps/daemon/src/main';

void runDaemon().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Daemon startup failed.'}\n`);
  process.exitCode = 1;
});
