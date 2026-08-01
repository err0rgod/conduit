#!/usr/bin/env node
require('../dist/index.js')
  .runCli()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Conduit command failed.'}\n`);
    process.exitCode = 1;
  });
