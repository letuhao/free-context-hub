/**
 * Typed REST API client for E2E tests.
 * Wraps native fetch with auth header support and status helpers.
 */

import { API_BASE } from './constants.js';

export type ApiResponse = {
  status: number;
  ok: boolean;
  body: any;
  raw: Response;
};

export function makeApiClient(baseUrl: string = API_BASE, defaultToken?: string) {
  async function request(method: string, path: string, body?: unknown, tokenOverride?: string): Promise<ApiResponse> {
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = tokenOverride ?? defaultToken;
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });

    let parsed: any;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      try { parsed = await res.json(); } catch { parsed = null; }
    } else {
      parsed = await res.text().catch(() => null);
    }

    return { status: res.status, ok: res.ok, body: parsed, raw: res };
  }

  return {
    get: (path: string, token?: string) => request('GET', path, undefined, token),
    post: (path: string, body?: unknown, token?: string) => request('POST', path, body, token),
    put: (path: string, body?: unknown, token?: string) => request('PUT', path, body, token),
    patch: (path: string, body?: unknown, token?: string) => request('PATCH', path, body, token),
    delete: (path: string, token?: string) => request('DELETE', path, undefined, token),

    /** POST multipart FormData (for file uploads). */
    async upload(path: string, formData: FormData, token?: string): Promise<ApiResponse> {
      const url = `${baseUrl}${path}`;
      const headers: Record<string, string> = {};
      const t = token ?? defaultToken;
      if (t) headers['Authorization'] = `Bearer ${t}`;
      // Do NOT set Content-Type — fetch sets it with boundary for FormData
      const res = await fetch(url, { method: 'POST', headers, body: formData });
      let parsed: any;
      try { parsed = await res.json(); } catch { parsed = null; }
      return { status: res.status, ok: res.ok, body: parsed, raw: res };
    },
  };
}

/** Convenience: assert status code, throw with body on mismatch. */
export function expectStatus(res: ApiResponse, expected: number, context?: string) {
  if (res.status !== expected) {
    const prefix = context ? `[${context}] ` : '';
    const bodySnippet = typeof res.body === 'string' ? res.body.slice(0, 200) : JSON.stringify(res.body).slice(0, 200);
    throw new Error(`${prefix}Expected HTTP ${expected}, got ${res.status}: ${bodySnippet}`);
  }
}
