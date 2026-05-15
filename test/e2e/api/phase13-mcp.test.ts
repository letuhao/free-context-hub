/**
 * Phase 13 Sprint 13.7 Part A (r2 F2 fix) — MCP-path regression guard.
 *
 * DEFERRED-007 documented a latent MCP discriminatedUnion `_zod` regression
 * affecting claim_artifact, check_artifact_availability, submit_for_review,
 * list_review_requests. After Part D fixes (or applies a workaround), this
 * test file is the regression guard for future SDK/zod version skews.
 *
 * Each test calls one of the affected tools via tools/call and asserts:
 *   (a) result is NOT an error response with "_zod" in the message
 *   (b) result has the expected status field (claim/availability/submit/list shapes)
 */

import type { TestFn } from '../shared/testContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import { MCP_URL } from '../shared/constants.js';

const GROUP = 'phase13-mcp';

function mcpTest(name: string, fn: (ctx: any) => Promise<void>): TestFn {
  return async (ctx) => {
    const start = Date.now();
    try {
      await fn(ctx);
      return pass(name, GROUP, Date.now() - start);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg.includes('SKIP:')) return skip(name, GROUP, msg.replace('SKIP: ', ''));
      return fail(name, GROUP, Date.now() - start, msg);
    }
  };
}

interface McpCallResult {
  isError: boolean;
  text: string;
  parsed?: any;
}

async function callMcpTool(toolName: string, args: Record<string, any>): Promise<McpCallResult> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: args },
      id: 1,
    }),
  });
  const raw = await res.text();
  // SSE format: "event: message\ndata: {...}\n"
  const dataMatch = raw.match(/data:\s*(\{[^\n]*\})/);
  const json = dataMatch ? JSON.parse(dataMatch[1]) : null;
  const text = json?.result?.content?.[0]?.text ?? raw;
  const isError = json?.result?.isError === true;
  let parsed: any;
  // The text often has format "summary line\n{json}" — extract the JSON portion
  // by finding the first opening brace and parsing from there.
  try { parsed = JSON.parse(text); } catch {
    const firstBrace = text.indexOf('{');
    if (firstBrace >= 0) {
      try { parsed = JSON.parse(text.slice(firstBrace)); } catch { /* still not JSON */ }
    }
  }
  return { isError, text, parsed };
}

function assertNotZodError(result: McpCallResult, toolName: string): void {
  if (result.isError && result.text.includes('_zod')) {
    throw new Error(`${toolName}: DEFERRED-007 regression — got _zod error: ${result.text}`);
  }
  if (result.isError) {
    throw new Error(`${toolName}: MCP returned isError=true: ${result.text}`);
  }
}

export const allPhase13McpTests: TestFn[] = [
  mcpTest('mcp-claim-artifact-no-zod-error', async ({ projectId, runMarker }) => {
    const r = await callMcpTool('claim_artifact', {
      project_id: projectId,
      agent_id: `mcp-test-${runMarker}`,
      artifact_type: 'custom',
      artifact_id: `mcp-claim-${runMarker}`,
      task_description: 'mcp regression test',
      ttl_minutes: 5,
    });
    assertNotZodError(r, 'claim_artifact');
    if (!r.parsed?.status) {
      throw new Error(`claim_artifact: expected parsed.status field; got text: ${r.text.slice(0, 200)}`);
    }
    // Cleanup: release the lease via REST (MCP release would hit same regression class)
    // For now we rely on cleanup runAll to handle it via force-release. Push to leaseIds.
    // (Note: parsed.status === 'claimed' has lease_id; if 'conflict' or 'rate_limited' there's nothing to clean.)
  }),

  mcpTest('mcp-check-artifact-availability-no-zod-error', async ({ projectId, runMarker }) => {
    const r = await callMcpTool('check_artifact_availability', {
      project_id: projectId,
      artifact_type: 'custom',
      artifact_id: `mcp-check-${runMarker}`,
    });
    assertNotZodError(r, 'check_artifact_availability');
    if (r.parsed?.available !== true && r.parsed?.available !== false) {
      throw new Error(`check_artifact_availability: expected parsed.available boolean; got: ${r.text.slice(0, 200)}`);
    }
  }),

  mcpTest('mcp-list-review-requests-no-zod-error', async ({ projectId }) => {
    const r = await callMcpTool('list_review_requests', {
      project_id: projectId,
      status: 'pending',
      limit: 5,
    });
    assertNotZodError(r, 'list_review_requests');
    if (!Array.isArray(r.parsed?.items)) {
      throw new Error(`list_review_requests: expected parsed.items array; got: ${r.text.slice(0, 200)}`);
    }
  }),

  // Note: submit_for_review requires a draft lesson; skip if too complex to set up in this test file.
  // Coverage of submit_for_review side effects is in phase13-reviews.test.ts (REST-level) plus
  // unit tests in src/services/reviewRequests.test.ts.
];
