/** Shared types and utilities for integration tests. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

export type TestGroup = 'lessons' | 'guardrails' | 'bootstrap' | 'tiered-search';

export type TestResult = {
  name: string;
  group: TestGroup;
  pass: boolean;
  message: string;
  duration_ms: number;
};

export type TestFn = (ctx: TestContext) => Promise<TestResult>;

export type TestContext = {
  client: Client;
  projectId: string;
  workspaceToken?: string;
  /** Lesson IDs created during tests — cleaned up at the end. */
  createdLessonIds: string[];
};

/** Extract JSON from MCP tool response text. */
export function extractJson(result: any): any {
  const content = result?.content ?? [];
  const firstText = content.find((c: any) => c?.type === 'text')?.text;
  if (typeof firstText !== 'string') throw new Error('Tool result missing text payload');
  const raw = firstText.trim();
  try {
    return JSON.parse(raw);
  } catch {
    // Try to extract JSON object from mixed text+json response (auto_both format).
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s >= 0 && e > s) return JSON.parse(raw.slice(s, e + 1));
    // Try array.
    const sa = raw.indexOf('[');
    const ea = raw.lastIndexOf(']');
    if (sa >= 0 && ea > sa) return JSON.parse(raw.slice(sa, ea + 1));
    throw new Error(`Cannot parse JSON from tool output: ${raw.slice(0, 200)}`);
  }
}

/** Call an MCP tool with timeout. */
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

/** Build common tool args with optional workspace_token. */
export function withAuth(args: Record<string, unknown>, token?: string): Record<string, unknown> {
  if (token) return { ...args, workspace_token: token };
  return args;
}

/** Create a passing TestResult. */
export function pass(name: string, group: TestGroup, duration_ms: number, message = ''): TestResult {
  return { name, group, pass: true, message, duration_ms };
}

/** Create a failing TestResult. */
export function fail(name: string, group: TestGroup, duration_ms: number, message: string): TestResult {
  return { name, group, pass: false, message, duration_ms };
}
