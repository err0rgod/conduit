import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createConduitMcpServer } from './index';

async function main(): Promise<void> {
  await createConduitMcpServer().connect(new StdioServerTransport());
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'MCP server failed.'}\n`);
  process.exitCode = 1;
});
