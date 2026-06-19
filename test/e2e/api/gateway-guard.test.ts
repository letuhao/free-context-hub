/**
 * Layer 2 — Single-port gateway cross-site guard (security regression).
 *
 * Proves the gateway's cross-site guard (gui/src/proxy.ts) actually BLOCKS the
 * browser-driven attack vectors it was built for, and still ALLOWS legitimate
 * traffic — the invariant the e2e happy-path suites do not exercise (Node
 * clients send no Sec-Fetch-Site, Playwright is same-origin).
 *
 * These tests only mean something when the suite targets the gateway origin
 * (API_BASE_URL=http://localhost:3002). When run directly against the backend
 * (no guard in front), they self-skip after a one-time probe.
 *
 * Also covers /api/system/info being behind auth (MED-1) — only when auth is on.
 */

import type { TestFn } from '../shared/testContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import { API_BASE, ADMIN_TOKEN } from '../shared/constants.js';

const GROUP = 'gateway-guard';
const ORIGIN = new URL(API_BASE).origin;
const FOREIGN = 'https://evil.example';

type Resp = { status: number; body: string };

async function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Resp> {
  const res = await fetch(`${ORIGIN}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text().catch(() => '');
  return { status: res.status, body: text };
}

const MCP_BODY = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const MCP_HEADERS = { accept: 'application/json, text/event-stream' };

// One-time probe: is a cross-site guard in front of this origin? A cross-site
// GET to a public endpoint returns 403 only when the gateway guard is present.
let _gateway: boolean | undefined;
async function gatewayPresent(): Promise<boolean> {
  if (_gateway === undefined) {
    const r = await call('GET', '/api/system/health', {
      'sec-fetch-site': 'cross-site',
      origin: FOREIGN,
    });
    _gateway = r.status === 403;
  }
  return _gateway;
}

async function requireGateway() {
  if (!(await gatewayPresent())) {
    throw new Error('SKIP: no cross-site guard in front (API_BASE is not the single-port gateway)');
  }
}

async function authEnabled(): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/me`, {
    headers: ADMIN_TOKEN ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {},
  });
  const body: any = await res.json().catch(() => ({}));
  return body?.auth_enabled === true;
}

function gwTest(name: string, fn: () => Promise<void>): TestFn {
  return async () => {
    const start = Date.now();
    try {
      await fn();
      return pass(name, GROUP, Date.now() - start);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg.includes('SKIP:')) return skip(name, GROUP, msg.replace('SKIP: ', ''));
      return fail(name, GROUP, Date.now() - start, msg);
    }
  };
}

function expect403(r: Resp, what: string) {
  if (r.status !== 403) throw new Error(`${what}: expected 403, got ${r.status} (${r.body.slice(0, 120)})`);
}
function expectNot403(r: Resp, what: string) {
  if (r.status === 403) throw new Error(`${what}: expected NOT 403, got 403 (${r.body.slice(0, 120)})`);
}

export const allGatewayGuardTests: TestFn[] = [
  // ── BLOCK: cross-site browser attacks ──
  gwTest('gateway-blocks-cross-site-api-read', async () => {
    await requireGateway();
    const r = await call('GET', '/api/system/health', { 'sec-fetch-site': 'cross-site', origin: FOREIGN });
    expect403(r, 'cross-site GET /api');
  }),

  gwTest('gateway-blocks-cross-site-api-write', async () => {
    await requireGateway();
    const r = await call('POST', '/api/lessons', { 'sec-fetch-site': 'cross-site', origin: FOREIGN }, {});
    expect403(r, 'cross-site POST /api/lessons');
  }),

  gwTest('gateway-blocks-cross-site-mcp', async () => {
    await requireGateway();
    const r = await call('POST', '/mcp', { 'sec-fetch-site': 'cross-site', origin: FOREIGN, ...MCP_HEADERS }, MCP_BODY);
    expect403(r, 'cross-site POST /mcp');
  }),

  // ── BLOCK: same-site to the all-powerful /mcp (fix #2) ──
  gwTest('gateway-blocks-same-site-mcp', async () => {
    await requireGateway();
    const r = await call('POST', '/mcp', { 'sec-fetch-site': 'same-site', origin: FOREIGN, ...MCP_HEADERS }, MCP_BODY);
    expect403(r, 'same-site POST /mcp');
  }),

  // ── ALLOW: same-site is tolerated for /api (only /mcp is same-origin-only) ──
  gwTest('gateway-allows-same-site-api', async () => {
    await requireGateway();
    const r = await call('GET', '/api/system/health', { 'sec-fetch-site': 'same-site' });
    expectNot403(r, 'same-site GET /api/system/health');
  }),

  // ── ALLOW: same-origin GUI traffic (the chat/SSE + page path) ──
  gwTest('gateway-allows-same-origin-api', async () => {
    await requireGateway();
    const r = await call('GET', '/api/system/health', { 'sec-fetch-site': 'same-origin' });
    if (r.status !== 200) throw new Error(`same-origin GET health: expected 200, got ${r.status}`);
  }),

  // ── ALLOW: non-browser clients (agents/curl) — no Sec-Fetch-Site ──
  gwTest('gateway-allows-non-browser-mcp', async () => {
    await requireGateway();
    const r = await call('POST', '/mcp', MCP_HEADERS, MCP_BODY);
    expectNot403(r, 'non-browser POST /mcp');
    if (r.status !== 200) throw new Error(`non-browser /mcp: expected 200, got ${r.status}`);
  }),

  // ── /api/system/info behind auth (MED-1) — only meaningful with auth on ──
  gwTest('gateway-info-requires-auth', async () => {
    if (!(await authEnabled())) throw new Error('SKIP: auth not enabled — /info gate only active with MCP_AUTH_ENABLED=true');
    const noToken = await call('GET', '/api/system/info', { 'sec-fetch-site': 'same-origin' });
    if (noToken.status !== 401) throw new Error(`/info without token: expected 401, got ${noToken.status}`);
    const withToken = await call('GET', '/api/system/info', {
      'sec-fetch-site': 'same-origin',
      authorization: `Bearer ${ADMIN_TOKEN}`,
    });
    if (withToken.status !== 200) throw new Error(`/info with token: expected 200, got ${withToken.status}`);
  }),
];
