import { runCli } from '../../cli/src/index';

void runCli().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Conduit command failed.'}\n`);
  process.exitCode = 1;
});
