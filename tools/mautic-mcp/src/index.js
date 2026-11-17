#!/usr/bin/env node
// MCP server (stdio) for the Mautic REST API.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MauticClient } from './mautic-client.js';
import { buildTools } from './tools.js';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function createServer(env = process.env, fetchImpl = globalThis.fetch) {
  const client = new MauticClient({
    baseUrl: env.MAUTIC_URL,
    clientId: env.MAUTIC_PUBLIC_KEY,
    clientSecret: env.MAUTIC_SECRET_KEY,
    fetchImpl,
  });
  const readOnly = ['1', 'true', 'yes'].includes(String(env.MAUTIC_MCP_READ_ONLY ?? '').toLowerCase());

  const server = new McpServer({ name: 'mautic', version: '1.0.0' });
  for (const tool of buildTools(client)) {
    if (readOnly && tool.write) {
      continue;
    }
    server.registerTool(tool.name, tool.config, async (args) => {
      try {
        return await tool.handler(args);
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
      }
    });
  }
  return server;
}

async function main() {
  // Optional: load credentials from a dotenv file, e.g. MAUTIC_ENV_FILE=/path/to/.env
  if (process.env.MAUTIC_ENV_FILE) {
    process.loadEnvFile(process.env.MAUTIC_ENV_FILE);
  }
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

const isEntryPoint = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
