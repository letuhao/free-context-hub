/**
 * Phase 13 Sprint 13.7 Part A — MCP-path regression guard.
 * Phase 13 bug-fix SS5: covers ALL four tools DEFERRED-007 affected
 * (claim_artifact, check_artifact_availability, submit_for_review,
 * renew_artifact — the original file omitted submit + renew) and registers
 * every created resource for cleanup (BUG-13.7-3 — the claim test leaked
 * its lease).
 *
 * Each test calls a tool via tools/call and asserts the result is NOT an
 * error response containing "_zod" (the DEFERRED-007 regression signature).
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
  const dataMatch = raw.match(/data:\s*(\{[^\n]*\})/);
  const json = dataMatch ? JSON.parse(dataMatch[1]) : null;
  const text = json?.result?.content?.[0]?.text ?? raw;
  const isError = json?.result?.isError === true;
  let parsed: any;
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
  mcpTest('mcp-claim-artifact-no-zod-error', async ({ projectId, runMarker, cleanup }) => {
    const agentId = `mcp-claim-${runMarker}`;
    const r = await callMcpTool('claim_artifact', {
      project_id: projectId,
      agent_id: agentId,
      artifact_type: 'custom',
      artifact_id: `mcp-claim-${runMarker}`,
      task_description: 'mcp regression test',
      ttl_minutes: 5,
    });
    assertNotZodError(r, 'claim_artifact');
    if (!r.parsed?.status) {
      throw new Error(`claim_artifact: expected parsed.status field; got text: ${r.text.slice(0, 200)}`);
    }
    // BUG-13.7-3 fix: register the claimed lease so cleanup releases it.
    if (r.parsed.status === 'claimed' && r.parsed.lease_id) {
      cleanup.leaseIds.push({ leaseId: r.parsed.lease_id, projectId, agentId });
    }
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

  mcpTest('mcp-renew-artifact-no-zod-error', async ({ projectId, runMarker, cleanup }) => {
    const agentId = `mcp-renew-${runMarker}`;
    const claim = await callMcpTool('claim_artifact', {
      project_id: projectId,
      agent_id: agentId,
      artifact_type: 'custom',
      artifact_id: `mcp-renew-${runMarker}`,
      task_description: 'renew regression test',
      ttl_minutes: 5,
    });
    assertNotZodError(claim, 'claim_artifact');
    if (claim.parsed?.status !== 'claimed' || !claim.parsed.lease_id) {
      throw new Error(`SKIP: could not claim a lease to renew (status=${claim.parsed?.status})`);
    }
    cleanup.leaseIds.push({ leaseId: claim.parsed.lease_id, projectId, agentId });
    const renew = await callMcpTool('renew_artifact', {
      project_id: projectId,
      agent_id: agentId,
      lease_id: claim.parsed.lease_id,
      extend_by_minutes: 10,
    });
    assertNotZodError(renew, 'renew_artifact');
    if (renew.parsed?.status !== 'renewed' && renew.parsed?.status !== 'cap_reached') {
      throw new Error(`renew_artifact: expected renewed/cap_reached; got: ${renew.text.slice(0, 200)}`);
    }
  }),

  mcpTest('mcp-submit-for-review-no-zod-error', async ({ api, projectId, runMarker, cleanup }) => {
    // submit_for_review needs a draft lesson — create one via REST.
    const lr = await api.post('/api/lessons', {
      project_id: projectId,
      lesson_type: 'general_note',
      title: `MCP submit regression ${runMarker}`,
      content: 'mcp submit_for_review _zod regression guard',
    });
    if (lr.status !== 201 || !lr.body?.lesson_id) {
      throw new Error(`SKIP: could not create a lesson (status=${lr.status})`);
    }
    const lessonId = lr.body.lesson_id;
    cleanup.lessonIds.push(lessonId);
    await api.patch(`/api/lessons/${lessonId}/status`, { project_id: projectId, status: 'draft' });

    const r = await callMcpTool('submit_for_review', {
      project_id: projectId,
      agent_id: `mcp-submit-${runMarker}`,
      lesson_id: lessonId,
    });
    assertNotZodError(r, 'submit_for_review');
    if (r.parsed?.status !== 'submitted') {
      throw new Error(`submit_for_review: expected status=submitted; got: ${r.text.slice(0, 200)}`);
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
];
