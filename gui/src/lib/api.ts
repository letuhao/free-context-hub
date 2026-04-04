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

  searchLessons: (body: { project_id?: string; project_ids?: string[]; group_id?: string; include_groups?: boolean; query: string; limit?: number }) =>
    request<any>("POST", "/api/lessons/search", body),

  updateLessonStatus: (id: string, body: Record<string, unknown>) =>
    request<any>("PATCH", `/api/lessons/${encodeURIComponent(id)}/status`, body),

  updateLesson: (id: string, body: { project_id: string; title?: string; content?: string; tags?: string[]; source_refs?: string[]; changed_by?: string; change_summary?: string }) =>
    request<{ status: string; re_embedded?: boolean; version_number?: number }>("PUT", `/api/lessons/${encodeURIComponent(id)}`, body),

  listLessonVersions: (id: string, params: { project_id: string }) =>
    request<{ status: string; versions?: any[]; total_count?: number }>("GET", `/api/lessons/${encodeURIComponent(id)}/versions?${qs(params)}`),

  batchUpdateLessonStatus: (body: { project_id: string; lesson_ids: string[]; status: string }) =>
    request<{ status: string; updated_count?: number; failed_ids?: string[] }>("POST", "/api/lessons/batch-status", body),

  improveLessonContent: (id: string, body: { project_id: string; instruction: string; selected_text?: string }) =>
    request<{ status: string; suggestions?: any[] }>("POST", `/api/lessons/${encodeURIComponent(id)}/improve`, body),

  // ── Guardrails ──
  checkGuardrails: (body: { project_id?: string; action_context: Record<string, unknown> }) =>
    request<any>("POST", "/api/guardrails/check", body),

  // ── Search ──
  searchCode: (body: Record<string, unknown>) =>
    request<any>("POST", "/api/search/code-tiered", body),

  // ── Projects ──
  listProjects: () =>
    request<{ projects: any[] }>("GET", "/api/projects"),

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

  getCommit: (sha: string, params: Record<string, string | number | undefined> = {}) =>
    request<any>("GET", `/api/git/commits/${encodeURIComponent(sha)}?${qs(params)}`),

  suggestLessons: (body: Record<string, unknown>) =>
    request<any>("POST", "/api/git/suggest-lessons", body),

  analyzeCommitImpact: (body: Record<string, unknown>) =>
    request<any>("POST", "/api/git/analyze-impact", body),

  reflectProject: (id: string, body: Record<string, unknown>) =>
    request<any>("POST", `/api/projects/${encodeURIComponent(id)}/reflect`, body),

  // ── Workspace / Sources ──
  listWorkspaceRoots: (params: Record<string, string | number | undefined> = {}) =>
    request<any>("GET", `/api/workspace/roots?${qs(params)}`),

  registerWorkspaceRoot: (body: Record<string, unknown>) =>
    request<any>("POST", "/api/workspace/register", body),

  scanWorkspace: (body: Record<string, unknown>) =>
    request<any>("POST", "/api/workspace/scan", body),

  getProjectSource: (params: Record<string, string | number | undefined> = {}) =>
    request<any>("GET", `/api/sources?${qs(params)}`),

  configureSource: (body: Record<string, unknown>) =>
    request<any>("POST", "/api/sources/configure", body),

  prepareRepo: (body: Record<string, unknown>) =>
    request<any>("POST", "/api/sources/prepare", body),

  // ── Generated Docs ──
  listGeneratedDocs: (params: Record<string, string | number | undefined> = {}) =>
    request<any>("GET", `/api/generated-docs?${qs(params)}`),

  getGeneratedDoc: (id: string, params: Record<string, string | number | undefined> = {}) =>
    request<any>("GET", `/api/generated-docs/${encodeURIComponent(id)}?${qs(params)}`),

  promoteGeneratedDoc: (id: string, body: Record<string, unknown>) =>
    request<any>("POST", `/api/generated-docs/${encodeURIComponent(id)}/promote`, body),

  // ── Project Groups ──
  listGroups: () =>
    request<{ groups: any[] }>("GET", "/api/groups"),

  createGroup: (body: { group_id: string; name: string; description?: string }) =>
    request<any>("POST", "/api/groups", body),

  deleteGroup: (groupId: string) =>
    request<{ deleted: boolean }>("DELETE", `/api/groups/${encodeURIComponent(groupId)}`),

  listGroupMembers: (groupId: string) =>
    request<{ group_id: string; members: string[] }>("GET", `/api/groups/${encodeURIComponent(groupId)}/members`),

  addProjectToGroup: (groupId: string, projectId: string) =>
    request<{ added: boolean }>("POST", `/api/groups/${encodeURIComponent(groupId)}/members`, { project_id: projectId }),

  removeProjectFromGroup: (groupId: string, projectId: string) =>
    request<{ removed: boolean }>("DELETE", `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(projectId)}`),

  listGroupsForProject: (projectId: string) =>
    request<{ project_id: string; groups: any[] }>("GET", `/api/groups/by-project/${encodeURIComponent(projectId)}`),

  // ── System ──
  health: () =>
    request<{ status: string; timestamp: string }>("GET", "/api/system/health"),

  info: () =>
    request<any>("GET", "/api/system/info"),
};
