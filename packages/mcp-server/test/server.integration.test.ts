import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSuccessResponse } from '@conduit/protocol';
import { ConduitMcpClient, createConduitMcpServer } from '../src/index';

describe('Conduit MCP server', () => {
  const closeCallbacks: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closeCallbacks.splice(0).map((close) => close()));
  });

  it('negotiates MCP, lists tools, and returns a typed browser result', async () => {
    const browser = vi.fn<ConduitMcpClient['browser']>().mockResolvedValue(
      createSuccessResponse({
        tabs: [{ id: 7, url: 'https://example.com', title: 'Example', active: true }],
      }),
    );
    const conduit: ConduitMcpClient = {
      health: async () => ({
        status: 'ok',
        extensionConnected: true,
        instanceId: '123e4567-e89b-12d3-a456-426614174000',
      }),
      browser,
    };
    const server = createConduitMcpServer(conduit);
    const client = new Client(
      { name: 'conduit-integration-test', version: '1.0.0' },
      { capabilities: {} },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closeCallbacks.push(
      () => client.close(),
      () => server.close(),
    );

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['conduit_status', 'browser_list_tabs', 'browser_screenshot']),
    );

    const result = await client.callTool({ name: 'browser_list_tabs', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '{}')).toEqual(
      expect.objectContaining({
        success: true,
        payload: expect.objectContaining({ tabs: expect.any(Array) }),
      }),
    );
    expect(browser).toHaveBeenCalledWith('browser.list_tabs');
  });

  it('returns invalid tool arguments as MCP errors without invoking the daemon', async () => {
    const browser = vi.fn<ConduitMcpClient['browser']>();
    const server = createConduitMcpServer({
      health: async () => ({
        status: 'ok',
        extensionConnected: false,
        instanceId: '123e4567-e89b-12d3-a456-426614174000',
      }),
      browser,
    });
    const client = new Client({ name: 'conduit-test', version: '1.0.0' }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closeCallbacks.push(
      () => client.close(),
      () => server.close(),
    );

    const result = await client.callTool({ name: 'browser_navigate', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual(
      expect.objectContaining({ type: 'text', text: expect.stringContaining('url is required') }),
    );
    expect(browser).not.toHaveBeenCalled();
  });
});
