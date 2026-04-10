/**
 * MCP client helpers for E2E tests.
 * Re-exports the patterns from src/qc/testTypes.ts with E2E defaults.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { MCP_URL } from './constants.js';

/** Connect to the MCP server. Caller must close when done. */
export async function connectMcp(url: string = MCP_URL): Promise<Client> {
  const client = new Client(
    { name: 'e2e-test-runner', version: '1.0.0' },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(new URL(url), {});
  await client.connect(transport);
  return client;
}

/** Call an MCP tool and return parsed JSON result. */
export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<any> {
  const out = await client.request(
    { method: 'tools/call', params: { name, arguments: args } },
    CallToolResultSchema,
    { timeout: timeoutMs },
  );
  return extractJson(out);
}

/** Extract JSON from MCP tool response text. */
export function extractJson(result: any): any {
  const content = result?.content ?? [];
  const firstText = content.find((c: any) => c?.type === 'text')?.text;
  if (typeof firstText !== 'string') throw new Error('Tool result missing text payload');
  const raw = firstText.trim();
  try {
    return JSON.parse(raw);
  } catch {
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s >= 0 && e > s) return JSON.parse(raw.slice(s, e + 1));
    const sa = raw.indexOf('[');
    const ea = raw.lastIndexOf(']');
    if (sa >= 0 && ea > sa) return JSON.parse(raw.slice(sa, ea + 1));
    throw new Error(`Cannot parse JSON from tool output: ${raw.slice(0, 200)}`);
  }
}

/** Conditionally add workspace_token to args. */
export function withAuth(args: Record<string, unknown>, token?: string): Record<string, unknown> {
  if (token) return { ...args, workspace_token: token };
  return args;
}
