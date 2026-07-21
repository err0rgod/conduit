import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  {
    name: 'conduit-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

async function sendCommand(action: any) {
  const res = await fetch('http://127.0.0.1:9222/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  });
  if (!res.ok) {
    throw new Error(`Daemon error: ${res.statusText}`);
  }
  return await res.json();
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'browser_list_tabs',
        description: 'List all open browser tabs',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'browser_open_tab',
        description: 'Open a new browser tab',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string' },
          },
          required: ['url'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    let result: any;
    if (request.params.name === 'browser_list_tabs') {
      result = await sendCommand({ type: 'list_tabs' });
    } else if (request.params.name === 'browser_open_tab') {
      const url = request.params.arguments?.url;
      result = await sendCommand({ type: 'open_tab', payload: { url } });
    } else {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (e: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: e.message,
        },
      ],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
