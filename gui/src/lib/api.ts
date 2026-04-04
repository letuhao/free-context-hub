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

  // ── Chat Conversations ──
  listConversations: (params: { project_id: string }) =>
    request<{ status: string; conversations?: any[] }>("GET", `/api/chat/conversations?${qs(params)}`),

  createConversation: (body: { project_id: string; title?: string }) =>
    request<{ status: string; conversation_id?: string }>("POST", "/api/chat/conversations", body),

  getConversation: (id: string, params: { project_id: string }) =>
    request<{ status: string; conversation?: any; messages?: any[] }>("GET", `/api/chat/conversations/${encodeURIComponent(id)}?${qs(params)}`),

  addMessage: (convId: string, body: { project_id: string; role: string; content: string }) =>
    request<{ status: string; message?: any }>("POST", `/api/chat/conversations/${encodeURIComponent(convId)}/messages`, body),

  toggleMessagePin: (convId: string, msgId: string) =>
    request<{ status: string; pinned?: boolean }>("PATCH", `/api/chat/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(msgId)}/pin`, {}),

  deleteConversation: (id: string, params: { project_id: string }) =>
    request<{ status: string; deleted?: boolean }>("DELETE", `/api/chat/conversations/${encodeURIComponent(id)}?${qs(params)}`),

  // ── Comments ──
  listComments: (lessonId: string) =>
    request<{ comments?: any[] }>("GET", `/api/lessons/${encodeURIComponent(lessonId)}/comments`),

  addComment: (lessonId: string, body: { author: string; content: string; parent_id?: string }) =>
    request<any>("POST", `/api/lessons/${encodeURIComponent(lessonId)}/comments`, body),

  deleteComment: (lessonId: string, commentId: string) =>
    request<any>("DELETE", `/api/lessons/${encodeURIComponent(lessonId)}/comments/${encodeURIComponent(commentId)}`),

  // ── Feedback ──
  getFeedback: (lessonId: string, userId?: string) =>
    request<{ up_count?: number; down_count?: number; user_vote?: number; retrieval_count?: number }>(
      "GET", `/api/lessons/${encodeURIComponent(lessonId)}/feedback${userId ? `?user_id=${encodeURIComponent(userId)}` : ""}`
    ),

  voteFeedback: (lessonId: string, body: { user_id: string; vote: 1 | -1 }) =>
    request<any>("POST", `/api/lessons/${encodeURIComponent(lessonId)}/feedback`, body),

  // ── Bookmarks ──
  listBookmarks: (params: { user_id: string; project_id: string }) =>
    request<{ bookmarks?: any[] }>("GET", `/api/bookmarks?${qs(params)}`),

  addBookmark: (body: { user_id: string; lesson_id: string }) =>
    request<any>("POST", "/api/bookmarks", body),

  removeBookmark: (params: { user_id: string; lesson_id: string }) =>
    request<any>("DELETE", `/api/bookmarks?${qs(params)}`),

  // ── Import/Export ──
  exportLessons: (params: { project_id: string; format?: string }) =>
    request<any>("GET", `/api/lessons/export?${qs(params)}`),

  importLessons: (body: { project_id: string; lessons: any[] }) =>
    request<{ status: string; imported_count?: number; skipped_count?: number; errors?: any[] }>("POST", "/api/lessons/import", body),

  // ── Activity ──
  listActivity: (params: Record<string, string | number | undefined> = {}) =>
    request<any>("GET", `/api/activity?${qs(params)}`),

  // ── Notifications ──
  listNotifications: (params: Record<string, string | number | undefined> = {}) =>
    request<any>("GET", `/api/notifications?${qs(params)}`),

  markNotificationsRead: (body: { notification_ids?: string[] }) =>
    request<any>("PATCH", "/api/notifications", body),

  // ── Analytics ──
  getRetrievalStats: (params: { project_id: string; days?: number }) =>
    request<any>("GET", `/api/analytics/retrieval-stats?${qs(params)}`),

  getStaleStats: (params: { project_id: string; days?: number }) =>
    request<any>("GET", `/api/analytics/stale?${qs(params)}`),

  getDeadKnowledge: (params: { project_id: string }) =>
    request<any>("GET", `/api/analytics/dead-knowledge?${qs(params)}`),

  // ── Learning Paths ──
  listLearningPaths: (params: { project_id: string }) =>
    request<any>("GET", `/api/learning-paths?${qs(params)}`),

  getLearningProgress: (pathId: string, params: { user_id: string }) =>
    request<any>("GET", `/api/learning-paths/${encodeURIComponent(pathId)}/progress?${qs(params)}`),

  updateLearningProgress: (pathId: string, body: { user_id: string; lesson_id: string; completed: boolean }) =>
    request<any>("PATCH", `/api/learning-paths/${encodeURIComponent(pathId)}/progress`, body),

  // ── Documents ──
  listDocuments: (params: Record<string, string | number | undefined> = {}) =>
    request<any>("GET", `/api/documents?${qs(params)}`),

  createDocument: (body: { project_id: string; name: string; doc_type: string; url?: string; content?: string; file_size_bytes?: number; description?: string; tags?: string[] }) =>
    request<any>("POST", "/api/documents", body),

  getDocument: (id: string, params: { project_id: string }) =>
    request<any>("GET", `/api/documents/${encodeURIComponent(id)}?${qs(params)}`),

  deleteDocument: (id: string, params: { project_id: string }) =>
    request<any>("DELETE", `/api/documents/${encodeURIComponent(id)}?${qs(params)}`),

  generateLessonsFromDoc: (id: string, body: { project_id: string; max_lessons?: number }) =>
    request<{ status: string; suggestions?: any[] }>("POST", `/api/documents/${encodeURIComponent(id)}/generate-lessons`, body),

  linkDocLesson: (docId: string, lessonId: string, body: { project_id: string }) =>
    request<any>("POST", `/api/documents/${encodeURIComponent(docId)}/lessons/${encodeURIComponent(lessonId)}`, body),

  unlinkDocLesson: (docId: string, lessonId: string, params: { project_id: string }) =>
    request<any>("DELETE", `/api/documents/${encodeURIComponent(docId)}/lessons/${encodeURIComponent(lessonId)}?${qs(params)}`),

  listDocLessons: (docId: string, params: { project_id: string }) =>
    request<any>("GET", `/api/documents/${encodeURIComponent(docId)}/lessons?${qs(params)}`),

  // ── Guardrails ──
  checkGuardrails: (body: { project_id?: string; action_context: Record<string, unknown> }) =>
    request<any>("POST", "/api/guardrails/check", body),

  // ── Search ──
  searchCode: (body: Record<string, unknown>) =>
    request<any>("POST", "/api/search/code-tiered", body),

  globalSearch: (params: { project_id: string; q: string; limit?: number }) =>
    request<{ lessons?: any[]; documents?: any[]; guardrails?: any[]; commits?: any[]; total_count?: number }>(
      "GET", `/api/search/global?${qs(params)}`
    ),

  suggestTags: (lessonId: string, body: { project_id: string }) =>
    request<{ suggestions?: string[]; current_tags?: string[] }>("POST", `/api/lessons/${encodeURIComponent(lessonId)}/suggest-tags`, body),

  getNotificationSettings: (params: { project_id: string; user_id?: string }) =>
    request<{ settings?: Record<string, boolean> }>("GET", `/api/notifications/settings?${qs(params)}`),

  updateNotificationSettings: (body: { project_id: string; user_id?: string; settings: Record<string, boolean> }) =>
    request<any>("PUT", "/api/notifications/settings", body),

  getRetrievalTimeseries: (params: { project_id: string; days?: number }) =>
    request<{ points?: { date: string; count: number }[] }>("GET", `/api/analytics/timeseries?${qs(params)}`),

  uploadDocument: async (body: FormData) => {
    const API_URL = process.env.NEXT_PUBLIC_CONTEXTHUB_API_URL ?? "http://localhost:3001";
    const res = await fetch(`${API_URL}/api/documents/upload`, { method: "POST", body });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  },

  // ── Agents ──
  listAgents: (params: { project_id: string }) =>
    request<{ agents?: any[] }>("GET", `/api/agents?${qs(params)}`),

  updateAgentTrust: (agentId: string, body: { project_id: string; trust_level?: string; auto_approve?: boolean }) =>
    request<any>("PATCH", `/api/agents/${encodeURIComponent(agentId)}`, body),

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
