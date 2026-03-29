/**
 * Typed HTTP client for the ContextHub REST API.
 * Uses native fetch (Node 18+) — no external dependencies.
 */

export interface RestClientOptions {
  baseUrl: string;       // e.g. "http://localhost:3001"
  token?: string;        // Bearer token (CONTEXT_HUB_WORKSPACE_TOKEN)
}

export class RestApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'RestApiError';
  }
}

export class RestClient {
  private baseUrl: string;
  private authHeaders: Record<string, string>;

  constructor(opts: RestClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.authHeaders = opts.token ? { Authorization: `Bearer ${opts.token}` } : {};
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { ...this.authHeaders };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let message: string;
      try {
        const json = JSON.parse(text);
        message = json.error ?? text;
      } catch {
        message = text || `HTTP ${res.status}`;
      }
      throw new RestApiError(res.status, message);
    }

    return res.json() as Promise<T>;
  }

  /** Verify the REST API is reachable. Throws on failure. */
  async checkHealth(): Promise<void> {
    try {
      await this.request<{ status: string }>('GET', '/api/system/health');
    } catch (err) {
      if (err instanceof RestApiError) {
        throw new Error(`ContextHub REST API health check failed (HTTP ${err.status}): ${err.message}`);
      }
      throw new Error(
        `Cannot connect to ContextHub REST API at ${this.baseUrl} — is the server running? (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  // ── Lessons ──
  async listLessons(params: {
    project_id?: string;
    limit?: number;
    after?: string;
    lesson_type?: string;
    tags_any?: string;
    status?: string;
  }) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.set(k, String(v));
    }
    return this.request<any>('GET', `/api/lessons?${qs}`);
  }

  async addLesson(body: Record<string, unknown>) {
    return this.request<any>('POST', '/api/lessons', body);
  }

  async searchLessons(body: { project_id?: string; query: string; filters?: Record<string, unknown>; limit?: number }) {
    return this.request<any>('POST', '/api/lessons/search', body);
  }

  async updateLessonStatus(lessonId: string, body: { project_id?: string; status: string; superseded_by?: string }) {
    return this.request<any>('PATCH', `/api/lessons/${encodeURIComponent(lessonId)}/status`, body);
  }

  // ── Guardrails ──
  async checkGuardrails(body: { project_id?: string; action_context: Record<string, unknown> }) {
    return this.request<any>('POST', '/api/guardrails/check', body);
  }

  // ── Search ──
  async searchCodeTiered(body: {
    project_id?: string;
    query: string;
    kind?: string;
    max_files?: number;
    semantic_threshold?: number;
  }) {
    return this.request<any>('POST', '/api/search/code-tiered', body);
  }

  // ── Projects ──
  async getProjectSummary(projectId: string) {
    return this.request<any>('GET', `/api/projects/${encodeURIComponent(projectId)}/summary`);
  }

  async indexProject(projectId: string, body?: { root?: string; lines_per_chunk?: number; embedding_batch_size?: number }) {
    return this.request<any>('POST', `/api/projects/${encodeURIComponent(projectId)}/index`, body ?? {});
  }

  async reflect(projectId: string, body: { topic: string; bullets?: string[] }) {
    return this.request<any>('POST', `/api/projects/${encodeURIComponent(projectId)}/reflect`, body);
  }

  async deleteWorkspace(projectId: string) {
    return this.request<any>('DELETE', `/api/projects/${encodeURIComponent(projectId)}`);
  }

  // ── Git ──
  async ingestGitHistory(body: { project_id?: string; root?: string; max_commits?: number; since?: string }) {
    return this.request<any>('POST', '/api/git/ingest', body);
  }

  async listCommits(params: { project_id?: string; limit?: number }) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.set(k, String(v));
    }
    return this.request<any>('GET', `/api/git/commits?${qs}`);
  }

  // ── Jobs ──
  async enqueueJob(body: Record<string, unknown>) {
    return this.request<any>('POST', '/api/jobs', body);
  }

  async listJobs(params: { project_id?: string; status?: string; limit?: number }) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.set(k, String(v));
    }
    return this.request<any>('GET', `/api/jobs?${qs}`);
  }
}
