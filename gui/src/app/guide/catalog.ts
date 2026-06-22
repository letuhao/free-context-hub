// Feature catalog for the in-app guide (/guide).
// Mirrors the repo-root FEATURES.md map. Static + client-rendered so the guide
// works with zero API dependency. Keep in sync with FEATURES.md and docs/features/.

export type Surface = {
  mcp?: string[]; // MCP tool names
  rest?: string; // representative REST path
  gui?: { label: string; href: string } | null; // in-app route
};

export type Feature = {
  name: string;
  description: string;
  surface: Surface;
};

export type Area = {
  id: string;
  title: string;
  blurb: string;
  /** lucide-react icon name, resolved in the page */
  icon: string;
  doc: string; // path to the detailed markdown doc (for reference)
  features: Feature[];
};

export const CATALOG: Area[] = [
  {
    id: "memory",
    title: "Memory & Lessons",
    blurb:
      "Capture decisions, preferences, workarounds, and guardrails once; retrieve them across sessions and agents.",
    icon: "BookOpen",
    doc: "docs/features/01-memory-lessons.md",
    features: [
      {
        name: "Capture a lesson",
        description: "Store a decision/preference/workaround/guardrail with tags.",
        surface: { mcp: ["add_lesson"], rest: "POST /api/lessons", gui: { label: "Lessons", href: "/lessons" } },
      },
      {
        name: "Browse & filter lessons",
        description: "List lessons with type/tag/status filters and version history.",
        surface: { mcp: ["list_lessons", "list_lesson_versions"], rest: "GET /api/lessons", gui: { label: "Lessons", href: "/lessons" } },
      },
      {
        name: "Update content & lifecycle",
        description: "Edit a lesson (auto re-embed) and move it through draft → active → superseded → archived.",
        surface: { mcp: ["update_lesson", "update_lesson_status"], rest: "PUT /api/lessons/:id", gui: { label: "Lesson detail", href: "/lessons" } },
      },
      {
        name: "Synthesize across lessons",
        description: "LLM-synthesized answer drawn from multiple retrieved lessons.",
        surface: { mcp: ["reflect", "compress_context"], rest: "POST /api/projects/:id/reflect", gui: { label: "Reflect", href: "/knowledge/reflect" } },
      },
      {
        name: "Custom lesson types & taxonomies",
        description: "Define project-specific lesson types and activate taxonomy profiles.",
        surface: { mcp: ["activate_taxonomy_profile", "list_taxonomy_profiles"], rest: "/api/lesson-types", gui: { label: "Lesson Types", href: "/settings/lesson-types" } },
      },
    ],
  },
  {
    id: "search",
    title: "Search & Retrieval",
    blurb: "Semantic + lexical search across lessons, code, and documents, with optional reranking.",
    icon: "Search",
    doc: "docs/features/02-search-retrieval.md",
    features: [
      {
        name: "Semantic lesson search",
        description: "Vector search over lessons, deduped and salience-weighted.",
        surface: { mcp: ["search_lessons"], rest: "POST /api/lessons/search", gui: { label: "Lessons", href: "/lessons" } },
      },
      {
        name: "Tiered code search",
        description: "ripgrep → symbol → full-text → semantic, auto-selected by file kind.",
        surface: { mcp: ["search_code_tiered", "search_code"], rest: "POST /api/search/code-tiered", gui: { label: "Code Search", href: "/knowledge/search" } },
      },
      {
        name: "Global search (Cmd+K)",
        description: "One overlay across all knowledge, available on every page.",
        surface: { rest: "GET /api/search/global", gui: { label: "Press Cmd+K", href: "/" } },
      },
      {
        name: "Document chunk search",
        description: "Hybrid semantic + full-text search over extracted document chunks.",
        surface: { mcp: ["search_document_chunks"], rest: "GET /api/documents/:id/chunks", gui: { label: "Documents", href: "/documents" } },
      },
    ],
  },
  {
    id: "guardrails",
    title: "Guardrails",
    blurb: "Pre-action policy checks that block risky operations before they run.",
    icon: "Shield",
    doc: "docs/features/03-guardrails.md",
    features: [
      {
        name: "Pre-action check",
        description: "Evaluate guardrails before git push, deploy, migration, or delete. Returns pass + prompt.",
        surface: { mcp: ["check_guardrails"], rest: "POST /api/guardrails/check", gui: { label: "Guardrails", href: "/guardrails" } },
      },
      {
        name: "Simulate ('what would block?')",
        description: "Test an action against current rules without performing it.",
        surface: { rest: "POST /api/guardrails/simulate", gui: { label: "Guardrails", href: "/guardrails" } },
      },
    ],
  },
  {
    id: "code-intel",
    title: "Code Intelligence",
    blurb: "Git ingestion, commit impact, and an optional symbol-level knowledge graph.",
    icon: "GitBranch",
    doc: "docs/features/04-code-intelligence.md",
    features: [
      {
        name: "Ingest git history",
        description: "Pull commits + changed files into Postgres for analysis.",
        surface: { mcp: ["ingest_git_history", "list_commits", "get_commit"], rest: "POST /api/git/ingest", gui: { label: "Git History", href: "/projects/git" } },
      },
      {
        name: "Suggest lessons from commits",
        description: "Turn recurring commit patterns into draft lesson proposals.",
        surface: { mcp: ["suggest_lessons_from_commits", "analyze_commit_impact"], rest: "POST /api/git/suggest-lessons", gui: { label: "Git History", href: "/projects/git" } },
      },
      {
        name: "Symbol graph (Neo4j)",
        description: "Symbol search, neighbors, dependency-path tracing, and lesson impact. Requires KG_ENABLED.",
        surface: { mcp: ["search_symbols", "get_symbol_neighbors", "trace_dependency_path", "get_lesson_impact"], gui: { label: "Graph Explorer", href: "/knowledge/graph" } },
      },
      {
        name: "Index a project",
        description: "Discover → chunk → embed → store vectors for code search.",
        surface: { mcp: ["index_project"], rest: "POST /api/projects/:id/index", gui: { label: "Sources", href: "/projects/sources" } },
      },
    ],
  },
  {
    id: "documents",
    title: "Documents & Ingestion",
    blurb: "Multi-format extraction (PDF/DOCX/image/URL) with chunked, searchable knowledge.",
    icon: "Files",
    doc: "docs/features/05-documents-ingestion.md",
    features: [
      {
        name: "Upload & extract",
        description: "PDF, DOCX, and images with fast/quality/vision extraction modes.",
        surface: { rest: "POST /api/documents/upload", gui: { label: "Documents", href: "/documents" } },
      },
      {
        name: "Ingest from URL",
        description: "SSRF-hardened URL ingestion with DNS-rebinding pinning. Agents can ingest over MCP.",
        surface: { mcp: ["ingest_document"], rest: "POST /api/documents/ingest-url", gui: { label: "Documents", href: "/documents" } },
      },
      {
        name: "Generated docs",
        description: "Browse FAQ/RAPTOR/QC/benchmark docs and promote them to active knowledge.",
        surface: { mcp: ["list_generated_documents", "get_generated_document", "promote_generated_document"], rest: "/api/generated-docs", gui: { label: "Generated Docs", href: "/knowledge/docs" } },
      },
    ],
  },
  {
    id: "coordination",
    title: "Coordination",
    blurb: "Multi-actor topics, a task board, and artifact leasing to stop agents colliding.",
    icon: "Network",
    doc: "docs/features/06-coordination.md",
    features: [
      {
        name: "Topics",
        description: "Charter/join/close a bounded initiative with a durable event log.",
        surface: { mcp: ["charter_topic", "join_topic", "get_topic", "close_topic", "replay_topic_events"], rest: "/api/topics", gui: null },
      },
      {
        name: "Task board",
        description: "Post/claim/complete tasks with fencing-tokened artifact leases.",
        surface: { mcp: ["post_task", "list_board", "claim_task", "complete_task", "write_artifact"], rest: "/api/topics/:id/tasks", gui: null },
      },
      {
        name: "Artifact leasing",
        description: "Exclusive, TTL-bounded leases to prevent duplicate work.",
        surface: { mcp: ["claim_artifact", "release_artifact", "renew_artifact", "list_active_claims", "check_artifact_availability"], rest: "/api/projects/:id/artifact-leases", gui: null },
      },
    ],
  },
  {
    id: "governance",
    title: "Governance & Decisions",
    blurb: "Approval routing, motions/voting, intake triage, and dispute resolution.",
    icon: "Scale",
    doc: "docs/features/07-governance-decisions.md",
    features: [
      {
        name: "Approval routing",
        description: "Submit a request that routes through a delegation-of-authority matrix.",
        surface: { mcp: ["submit_request", "list_requests", "get_request", "decide_request_step"], rest: "/api/topics/:id/requests", gui: null },
      },
      {
        name: "Motions & voting",
        description: "Propose, second, vote, veto, and tally motions in a weighted decision body.",
        surface: { mcp: ["propose_motion", "second_motion", "cast_vote", "veto_motion", "tally_motion"], rest: "/api/topics/:id/motions", gui: null },
      },
      {
        name: "Intake & disputes",
        description: "A project mailbox for reports/suggestions, triaged or escalated to disputes.",
        surface: { mcp: ["submit_intake", "triage_intake", "open_dispute", "resolve_dispute"], rest: "/api/intake", gui: null },
      },
      {
        name: "Review queue",
        description: "Approve or return AI-generated lessons awaiting human review.",
        surface: { mcp: ["submit_for_review", "list_review_requests"], rest: "/api/projects/:id/review-requests", gui: { label: "Review Inbox", href: "/review" } },
      },
    ],
  },
  {
    id: "access",
    title: "Access Control & Identity",
    blurb: "Principals, capability grants, API keys, sessions, and end-to-end tenant scope.",
    icon: "KeyRound",
    doc: "docs/features/08-access-control-identity.md",
    features: [
      {
        name: "Who am I",
        description: "Resolve the caller's authenticated principal and scope.",
        surface: { mcp: ["whoami"], rest: "GET /api/me", gui: { label: "Identity", href: "/identity" } },
      },
      {
        name: "Capability grants",
        description: "Grant/revoke capabilities at a scope and explain authorization decisions.",
        surface: { mcp: ["grant_capability", "revoke_grant", "list_grants", "explain_authorization"], rest: "/api/grants", gui: { label: "Delegation", href: "/delegation" } },
      },
      {
        name: "API keys & ephemeral keys",
        description: "Per-principal keys with roles; short-lived keys for CI and agents.",
        surface: { mcp: ["mint_ephemeral_key"], rest: "/api/api-keys", gui: { label: "Access Control", href: "/settings/access" } },
      },
      {
        name: "Login, MFA & sessions",
        description: "Password login with TOTP MFA; list and revoke active sessions.",
        surface: { rest: "/api/auth", gui: { label: "Sessions & Security", href: "/settings/sessions" } },
      },
    ],
  },
  {
    id: "projects",
    title: "Projects & Portability",
    blurb: "Multi-project organization, groups, and knowledge export/import/pull.",
    icon: "FolderOpen",
    doc: "docs/features/09-projects-portability.md",
    features: [
      {
        name: "Projects & groups",
        description: "Organize knowledge per tenant; group projects to share it.",
        surface: { mcp: ["get_project_summary", "create_group", "add_project_to_group"], rest: "/api/projects", gui: { label: "Projects", href: "/projects" } },
      },
      {
        name: "Sources & workspace roots",
        description: "Configure git source and register workspace roots for indexing.",
        surface: { mcp: ["configure_project_source", "prepare_repo", "register_workspace_root"], rest: "/api/workspace", gui: { label: "Sources", href: "/projects/sources" } },
      },
      {
        name: "Export / import / pull",
        description: "Zip+JSONL bundles with conflict policies; pull a project from another instance.",
        surface: { rest: "POST /api/projects/:id/export", gui: { label: "Project Settings", href: "/projects/settings" } },
      },
    ],
  },
  {
    id: "gui",
    title: "Human-in-the-Loop GUI",
    blurb: "Dashboard, chat, review, analytics, and audit — where humans steer the knowledge.",
    icon: "LayoutDashboard",
    doc: "docs/features/10-gui.md",
    features: [
      {
        name: "Dashboard",
        description: "Project health, stats, setup checklist, and recent activity.",
        surface: { gui: { label: "Dashboard", href: "/" } },
      },
      {
        name: "AI Chat",
        description: "Streaming chat with tool calls; pin a reply into a lesson.",
        surface: { rest: "POST /api/chat", gui: { label: "Chat", href: "/chat" } },
      },
      {
        name: "Analytics & Activity",
        description: "Retrieval trends, approval rates, dead knowledge, and an event timeline.",
        surface: { rest: "/api/analytics", gui: { label: "Analytics", href: "/analytics" } },
      },
      {
        name: "Agent audit",
        description: "What each agent has done — guardrail checks and lessons created.",
        surface: { rest: "/api/agents", gui: { label: "Agent Audit", href: "/agents" } },
      },
    ],
  },
  {
    id: "jobs",
    title: "Jobs & Operations",
    blurb: "Background job queue, workspace indexing, system health, and model config.",
    icon: "Zap",
    doc: "docs/features/11-jobs-operations.md",
    features: [
      {
        name: "Job queue",
        description: "Enqueue, run, and monitor async jobs (index, ingest, extract, re-embed).",
        surface: { mcp: ["enqueue_job", "run_next_job", "list_jobs"], rest: "/api/jobs", gui: { label: "Jobs", href: "/jobs" } },
      },
      {
        name: "System health & info",
        description: "Liveness probe and a feature/model report for monitoring.",
        surface: { rest: "GET /api/system/info", gui: { label: "Settings", href: "/settings" } },
      },
      {
        name: "Model providers",
        description: "Configure LLM providers and assign them to embeddings/distillation/reranking.",
        surface: { gui: { label: "Model Providers", href: "/settings/models" } },
      },
    ],
  },
];

export const TOTALS = { mcpTools: 105, restEndpoints: 95, guiPages: 32 };
