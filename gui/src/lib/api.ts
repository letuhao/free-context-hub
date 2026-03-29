/**
 * ContextHub REST API client for the GUI.
 * Talks to the backend REST API on API_URL (default http://localhost:3001).
 */

const API_URL = process.env.NEXT_PUBLIC_CONTEXTHUB_API_URL ?? "http://localhost:3001";
const API_TOKEN = process.env.NEXT_PUBLIC_CONTEXTHUB_TOKEN;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (API_TOKEN) headers["Authorization"] = `Bearer ${API_TOKEN}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message: string;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      message = text || `HTTP ${res.status}`;
    }
    throw new Error(`API error (${res.status}): ${message}`);
  }

  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.set(k, String(v));
  }
  return sp.toString();
}

// ── Lessons ──
export const api = {
  listLessons: (params: Record<string, string | number | undefined> = {}) =>
    request<any>("GET", `/api/lessons?${qs(params)}`),

  addLesson: (body: Record<string, unknown>) =>
    request<any>("POST", "/api/lessons", body),

  searchLessons: (body: { project_id?: string; query: string; limit?: number }) =>
    request<any>("POST", "/api/lessons/search", body),

  updateLessonStatus: (id: string, body: Record<string, unknown>) =>
    request<any>("PATCH", `/api/lessons/${encodeURIComponent(id)}/status`, body),

  // ── Guardrails ──
  checkGuardrails: (body: { project_id?: string; action_context: Record<string, unknown> }) =>
    request<any>("POST", "/api/guardrails/check", body),

  // ── Search ──
  searchCode: (body: Record<string, unknown>) =>
    request<any>("POST", "/api/search/code-tiered", body),

  // ── Projects ──
  getProjectSummary: (id: string) =>
    request<any>("GET", `/api/projects/${encodeURIComponent(id)}/summary`),

  indexProject: (id: string, body?: Record<string, unknown>) =>
    request<any>("POST", `/api/projects/${encodeURIComponent(id)}/index`, body ?? {}),

  deleteWorkspace: (id: string) =>
    request<any>("DELETE", `/api/projects/${encodeURIComponent(id)}`),

  // ── Git ──
  ingestGit: (body: Record<string, unknown>) =>
    request<any>("POST", "/api/git/ingest", body),

  listCommits: (params: Record<string, string | number | undefined> = {}) =>
    request<any>("GET", `/api/git/commits?${qs(params)}`),

  // ── Jobs ──
  enqueueJob: (body: Record<string, unknown>) =>
    request<any>("POST", "/api/jobs", body),

  listJobs: (params: Record<string, string | number | undefined> = {}) =>
    request<any>("GET", `/api/jobs?${qs(params)}`),

  // ── System ──
  health: () =>
    request<{ status: string; timestamp: string }>("GET", "/api/system/health"),

  info: () =>
    request<Record<string, unknown>>("GET", "/api/system/info"),
};
