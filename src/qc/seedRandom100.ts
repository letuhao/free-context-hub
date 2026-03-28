/**
 * Seed 100 additional diverse lessons simulating real project knowledge.
 * Covers: API design, frontend patterns, testing strategies, DevOps,
 * business logic, team conventions, debugging tips, performance, security.
 *
 * Usage: npx tsx src/qc/seedRandom100.ts
 */
import * as dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

dotenv.config();

const MCP_URL = process.env.MCP_SERVER_URL?.trim() || 'http://localhost:3000/mcp';
const PID = 'free-context-hub';

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const r = await client.request(
    { method: 'tools/call', params: { name, arguments: args } },
    CallToolResultSchema,
    { timeout: 60000 },
  );
  const txt = (r.content as any)[0]?.text || '';
  try { const s = txt.indexOf('{'); return JSON.parse(txt.slice(s, txt.lastIndexOf('}') + 1)); }
  catch { return txt; }
}

type L = { lesson_type: string; title: string; content: string; tags: string[] };

const LESSONS: L[] = [
  // === API Design (10) ===
  { lesson_type: 'decision', title: 'REST API uses JSON:API error format', content: 'All API errors return { errors: [{ status, code, title, detail }] } format. Consistent across all endpoints. Clients parse errors array for user-facing messages.', tags: ['api', 'error-handling'] },
  { lesson_type: 'preference', title: 'API versioning via URL path not headers', content: 'API version in URL: /api/v1/users. Not Accept header versioning. Simpler for debugging and curl testing. Breaking changes get new version prefix.', tags: ['api', 'versioning'] },
  { lesson_type: 'decision', title: 'Pagination uses cursor-based not offset-based', content: 'All list endpoints use cursor pagination: { items, next_cursor }. Cursor is opaque string (base64 encoded ID). Prevents skipped/duplicate items during concurrent writes.', tags: ['api', 'pagination'] },
  { lesson_type: 'preference', title: 'HTTP 422 for validation errors, 400 for malformed requests', content: '422 Unprocessable Entity for business validation failures (email already taken). 400 Bad Request for malformed JSON or missing required fields.', tags: ['api', 'http-status'] },
  { lesson_type: 'decision', title: 'Rate limiting: 100 requests per minute per API key', content: 'Rate limiter uses sliding window in Redis. Returns 429 with Retry-After header. Admin endpoints have separate higher limit (500/min).', tags: ['api', 'rate-limiting'] },
  { lesson_type: 'workaround', title: 'CORS preflight fails with custom headers', content: 'Browser sends OPTIONS preflight for custom headers. Must respond with Access-Control-Allow-Headers listing custom header names. Missing this causes silent CORS block.', tags: ['api', 'cors'] },
  { lesson_type: 'decision', title: 'Webhook payloads include HMAC signature for verification', content: 'Outgoing webhooks include X-Signature header: HMAC-SHA256 of body with shared secret. Consumers verify signature before processing. Prevents spoofed webhook calls.', tags: ['api', 'webhooks', 'security'] },
  { lesson_type: 'preference', title: 'Always return created resource in POST response', content: 'POST /api/v1/users returns 201 with the full created user object. Avoids client needing a follow-up GET. Include server-generated fields (id, created_at).', tags: ['api', 'rest'] },
  { lesson_type: 'general_note', title: 'GraphQL considered but rejected for simplicity', content: 'Team evaluated GraphQL but chose REST. Reasons: simpler caching, easier debugging with curl, smaller team does not need schema flexibility. Revisit if frontend needs change.', tags: ['api', 'decision-log'] },
  { lesson_type: 'workaround', title: 'Large file uploads use presigned S3 URLs', content: 'Direct uploads to API gateway timeout at 10MB. Instead: client requests presigned S3 URL, uploads directly to S3, then notifies API with the S3 key.', tags: ['api', 'file-upload', 's3'] },

  // === Frontend Patterns (10) ===
  { lesson_type: 'decision', title: 'React with TypeScript for all frontend components', content: 'All frontend uses React 18 with TypeScript strict mode. No JavaScript files in frontend code. Use function components and hooks, no class components.', tags: ['frontend', 'react', 'typescript'] },
  { lesson_type: 'preference', title: 'TailwindCSS for styling, no CSS modules', content: 'Team uses TailwindCSS utility classes exclusively. No CSS modules, styled-components, or inline styles. Keeps styling colocated with markup and avoids specificity wars.', tags: ['frontend', 'css', 'tailwind'] },
  { lesson_type: 'decision', title: 'State management with React Query for server state', content: 'Server state (API data) managed by React Query (TanStack Query). Local UI state uses useState/useReducer. No Redux — too much boilerplate for our scale.', tags: ['frontend', 'state-management'] },
  { lesson_type: 'workaround', title: 'React hydration mismatch with server-rendered dates', content: 'Server renders dates in UTC, client in local timezone. Causes hydration mismatch. Fix: render dates client-side only with useEffect or suppressHydrationWarning.', tags: ['frontend', 'ssr', 'debugging'] },
  { lesson_type: 'preference', title: 'Component files colocated with their tests', content: 'Component.tsx and Component.test.tsx in same directory. Not in separate __tests__ folder. Makes it easy to find tests and ensures no orphaned test files.', tags: ['frontend', 'testing', 'file-structure'] },
  { lesson_type: 'decision', title: 'Form validation with Zod schemas shared with backend', content: 'Form validation uses Zod schemas. Same schema validates on frontend (react-hook-form) and backend (API handler). Single source of truth for validation rules.', tags: ['frontend', 'validation', 'zod'] },
  { lesson_type: 'workaround', title: 'Bundle size bloat from date-fns — use dayjs instead', content: 'date-fns tree-shaking broken with some bundlers, adding 200KB. Switched to dayjs (2KB). Import only needed plugins: dayjs/plugin/relativeTime.', tags: ['frontend', 'performance', 'bundle-size'] },
  { lesson_type: 'general_note', title: 'Accessibility: all interactive elements need keyboard support', content: 'Every clickable element must be focusable and activatable via Enter/Space. Use semantic HTML (button, a, input) instead of div onClick. WCAG 2.1 AA compliance required.', tags: ['frontend', 'accessibility'] },
  { lesson_type: 'preference', title: 'Error boundaries at route level, not component level', content: 'Place React error boundaries at route/page level. Individual component errors should be caught by the page boundary. Prevents white screen, shows fallback UI.', tags: ['frontend', 'error-handling'] },
  { lesson_type: 'decision', title: 'Next.js App Router for frontend routing', content: 'Using Next.js 14 App Router (not Pages Router). Server components by default, client components explicitly marked. API routes in app/api/ directory.', tags: ['frontend', 'nextjs', 'routing'] },

  // === Testing (10) ===
  { lesson_type: 'decision', title: 'E2E tests with Playwright, not Cypress', content: 'Chose Playwright for E2E: faster execution, better multi-browser support, native TypeScript. Cypress was considered but slower and requires separate runner.', tags: ['testing', 'e2e', 'playwright'] },
  { lesson_type: 'preference', title: 'Test names describe behavior, not implementation', content: 'Bad: "calls handleSubmit". Good: "submits form when all fields valid". Tests should read like requirements, survive refactoring.', tags: ['testing', 'naming'] },
  { lesson_type: 'workaround', title: 'Flaky tests from race conditions in async operations', content: 'Tests intermittently fail when awaiting async state updates. Fix: use waitFor() or findBy* queries instead of getBy* with manual timeouts. Never use sleep() in tests.', tags: ['testing', 'flaky-tests'] },
  { lesson_type: 'decision', title: 'Test database uses separate schema, not mock', content: 'Integration tests run against real PostgreSQL with test schema. No mocking DB queries. Ensures SQL compatibility. Each test suite gets clean schema via truncate.', tags: ['testing', 'database'] },
  { lesson_type: 'preference', title: 'Snapshot tests only for serialized data, not UI', content: 'Snapshot tests OK for JSON responses, GraphQL schemas, config objects. Not for React component renders — too brittle, meaningless diffs.', tags: ['testing', 'snapshots'] },
  { lesson_type: 'general_note', title: 'Test coverage target: 80% lines, 100% critical paths', content: 'Team aims for 80% line coverage overall. Auth flows, payment processing, data mutations must have 100% branch coverage. UI rendering can be lower.', tags: ['testing', 'coverage'] },
  { lesson_type: 'workaround', title: 'Mock external APIs with MSW, not jest.mock', content: 'Mock Service Worker (MSW) intercepts at network level, works in both tests and browser dev. jest.mock couples tests to implementation. MSW tests actual fetch calls.', tags: ['testing', 'mocking'] },
  { lesson_type: 'decision', title: 'CI runs tests in parallel with sharded workers', content: 'GitHub Actions splits test suite across 4 parallel workers using test file sharding. Reduces CI time from 12min to 4min. Each shard gets own DB schema.', tags: ['testing', 'ci', 'performance'] },
  { lesson_type: 'general_note', title: 'Seed data for tests lives in fixtures/ directory', content: 'Test fixtures in tests/fixtures/. JSON files with seed data for users, products, orders. Loaded by setupTestDb() helper before each test suite.', tags: ['testing', 'fixtures'] },
  { lesson_type: 'preference', title: 'Prefer testing library queries over test IDs', content: 'Use getByRole, getByText, getByLabelText over data-testid. Encourages accessible markup. data-testid only as last resort for complex interactive widgets.', tags: ['testing', 'react-testing-library'] },

  // === DevOps & Deployment (10) ===
  { lesson_type: 'decision', title: 'Deploy to AWS ECS Fargate, not EC2', content: 'Serverless containers on Fargate. No EC2 instance management, auto-scaling built in. Costs slightly more per CPU but saves ops time for small team.', tags: ['devops', 'aws', 'deployment'] },
  { lesson_type: 'preference', title: 'Infrastructure as code with Terraform, not CloudFormation', content: 'Terraform for all AWS infra. Multi-cloud compatible, better state management, richer ecosystem. CloudFormation too AWS-specific and verbose.', tags: ['devops', 'terraform', 'iac'] },
  { lesson_type: 'decision', title: 'GitHub Actions for CI/CD, not Jenkins', content: 'CI/CD via GitHub Actions. Tighter GitHub integration, YAML config in repo, no server to maintain. Jenkins considered overkill for team size.', tags: ['devops', 'ci', 'github-actions'] },
  { lesson_type: 'workaround', title: 'Docker layer caching in CI saves 3 minutes per build', content: 'Use actions/cache with Docker layer cache. Cache node_modules layer and build layer separately. Reduces build from 5min to 2min on cache hit.', tags: ['devops', 'docker', 'ci'] },
  { lesson_type: 'decision', title: 'Feature flags via environment variables, not service', content: 'Simple feature flags as env vars: FEATURE_NEW_DASHBOARD=true. No LaunchDarkly or similar — overkill for our scale. Flags checked at startup, not runtime.', tags: ['devops', 'feature-flags'] },
  { lesson_type: 'guardrail', title: 'Always deploy to staging before production', content: 'No direct production deploys. Staging must pass smoke tests before production promotion. Exception only for critical security patches with CTO approval.', tags: ['devops', 'deployment', 'guardrail'],
    guardrail: { trigger: '/deploy.*prod/', requirement: 'Deploy to staging first, verify smoke tests', verification_method: 'user_confirmation' } },
  { lesson_type: 'workaround', title: 'ECS task definition must specify memory limits', content: 'Fargate tasks without explicit memory limits default to 512MB. Our Node.js app needs 1024MB under load. Set both soft and hard limits in task definition.', tags: ['devops', 'aws', 'ecs'] },
  { lesson_type: 'general_note', title: 'Log aggregation via CloudWatch Logs Insights', content: 'All container logs go to CloudWatch. Use Logs Insights for querying. Structured JSON logs (pino) enable field-level filtering. Retention: 30 days.', tags: ['devops', 'logging', 'monitoring'] },
  { lesson_type: 'decision', title: 'Database backups: automated daily + manual before migrations', content: 'RDS automated daily backups with 7-day retention. Manual snapshot before any schema migration. Tested restore procedure quarterly.', tags: ['devops', 'database', 'backup'] },
  { lesson_type: 'general_note', title: 'SSL certificates managed by ACM, auto-renewed', content: 'AWS ACM provides free SSL certs with auto-renewal. Attached to ALB. No manual cert management. Domain validation via DNS (Route 53 CNAME).', tags: ['devops', 'security', 'ssl'] },

  // === Business Logic (15) ===
  { lesson_type: 'decision', title: 'User roles: admin, editor, viewer — no custom roles', content: 'Three fixed roles. Admin: full access. Editor: create/edit content. Viewer: read only. Custom roles rejected — adds complexity, three covers all use cases.', tags: ['business', 'authorization', 'roles'] },
  { lesson_type: 'decision', title: 'Email notifications via SendGrid, not SES', content: 'SendGrid for transactional emails: better deliverability, built-in templates, webhook for bounce/complaint tracking. SES cheaper but more setup work.', tags: ['business', 'email'] },
  { lesson_type: 'workaround', title: 'Timezone handling: store UTC, display local', content: 'All timestamps stored as UTC in database. Frontend converts to user local timezone for display. Never store local time. Use date-fns-tz for conversion.', tags: ['business', 'datetime'] },
  { lesson_type: 'decision', title: 'Soft delete for user data, hard delete after 30 days', content: 'User deletion sets deleted_at timestamp (soft delete). Data retained 30 days for recovery. Cron job hard deletes after retention period. GDPR compliant.', tags: ['business', 'data-retention', 'gdpr'] },
  { lesson_type: 'general_note', title: 'Invoice numbering: INV-YYYY-NNNNN sequential', content: 'Invoices numbered sequentially per year: INV-2026-00001. Counter stored in invoices_counter table. No gaps allowed — use SELECT FOR UPDATE to prevent race conditions.', tags: ['business', 'invoicing'] },
  { lesson_type: 'workaround', title: 'Currency amounts stored as integers (cents)', content: 'Never use float for money. Store amounts as integer cents: $19.99 = 1999. Divide by 100 for display. Prevents floating point rounding errors in calculations.', tags: ['business', 'finance'] },
  { lesson_type: 'decision', title: 'Search uses trigram matching for user-facing search', content: 'User search (products, users) uses pg_trgm for fuzzy matching. Handles typos: "iphone" matches "iPhone". Combined with tsvector for keyword relevance ranking.', tags: ['business', 'search'] },
  { lesson_type: 'preference', title: 'Audit log for all admin actions', content: 'Every admin action (user ban, content delete, role change) writes to audit_logs table with: actor_id, action, target, timestamp, ip_address. Non-deletable.', tags: ['business', 'audit', 'compliance'] },
  { lesson_type: 'decision', title: 'File storage: S3 with CloudFront CDN', content: 'User uploads go to S3 private bucket. Served via CloudFront with signed URLs (24h expiry). No direct S3 access. Reduces bandwidth costs and adds geo-distribution.', tags: ['business', 'storage', 'cdn'] },
  { lesson_type: 'workaround', title: 'Duplicate form submissions prevented by idempotency key', content: 'Frontend generates UUID idempotency key per form submission. Backend checks key before processing. Prevents double charges, double posts from network retries.', tags: ['business', 'idempotency'] },
  { lesson_type: 'general_note', title: 'Multi-tenancy via project_id column, not separate databases', content: 'All tenants share one database with project_id column on every table. Row-level security enforced in application layer. Simpler ops than per-tenant databases.', tags: ['business', 'multi-tenancy'] },
  { lesson_type: 'decision', title: 'Password policy: 12+ chars, no complexity rules', content: 'NIST 800-63B recommendations: minimum 12 characters, no forced uppercase/special chars. Check against breached password list (Have I Been Pwned API). bcrypt with cost 12.', tags: ['business', 'security', 'passwords'] },
  { lesson_type: 'preference', title: 'Session timeout: 30 minutes inactive, 24 hours absolute', content: 'JWT access token: 15 min. Refresh token: 24 hours. Sliding session extends on activity. Absolute 24h forces re-login. Balances security and usability.', tags: ['business', 'authentication', 'sessions'] },
  { lesson_type: 'workaround', title: 'Export large datasets via background job, not API response', content: 'CSV/Excel exports >10000 rows: enqueue background job, generate file to S3, email download link. Prevents API timeout and memory issues.', tags: ['business', 'export'] },
  { lesson_type: 'general_note', title: 'Analytics events sent to Mixpanel via server-side SDK', content: 'Track key events server-side (signup, purchase, feature_used) not client-side. More reliable, immune to ad blockers. Mixpanel server SDK in analytics.ts.', tags: ['business', 'analytics'] },

  // === Debugging & Performance (10) ===
  { lesson_type: 'workaround', title: 'Memory leak from unclosed database connections in tests', content: 'Jest test suites leaked DB connections. Each test file opened pool but afterAll did not close. Fix: call pool.end() in afterAll. Also set pool max to 5 in test env.', tags: ['debugging', 'database', 'memory-leak'] },
  { lesson_type: 'general_note', title: 'N+1 query detection with pg-query-stream logging', content: 'Enable query logging in development. Look for repeated queries with different IDs — indicates N+1. Fix with JOIN or DataLoader batch pattern.', tags: ['debugging', 'performance', 'database'] },
  { lesson_type: 'workaround', title: 'Response compression reduces API payload 70%', content: 'Express compression middleware reduces JSON responses from ~50KB to ~15KB. Enable gzip/brotli for all responses >1KB. Significant improvement on slow connections.', tags: ['performance', 'api'] },
  { lesson_type: 'decision', title: 'Redis for session storage, not in-memory', content: 'Sessions stored in Redis, not Node.js memory. Enables horizontal scaling (multiple Node processes share sessions). Also survives process restarts.', tags: ['performance', 'redis', 'sessions'] },
  { lesson_type: 'workaround', title: 'Slow queries: add composite index on (project_id, created_at)', content: 'Query SELECT * FROM events WHERE project_id=$1 ORDER BY created_at DESC was doing seq scan. Added composite index, query time 800ms → 3ms.', tags: ['performance', 'database', 'indexing'] },
  { lesson_type: 'general_note', title: 'Node.js heap size: set --max-old-space-size=2048 in production', content: 'Default V8 heap ~1.5GB. Our app peaks at 1.8GB during report generation. Set --max-old-space-size=2048 in Dockerfile CMD. Monitor with process.memoryUsage().', tags: ['performance', 'nodejs'] },
  { lesson_type: 'workaround', title: 'Connection pool exhaustion under burst traffic', content: 'Pool size 10 exhausted during traffic spike. Error: "cannot acquire connection". Fix: increase pool to 20, add connection timeout 5s, add retry with backoff.', tags: ['debugging', 'database', 'scaling'] },
  { lesson_type: 'general_note', title: 'Prometheus metrics endpoint at /metrics', content: 'Express app exposes /metrics for Prometheus scraping. Custom metrics: request_duration_seconds, db_query_duration, queue_depth. Grafana dashboards for visualization.', tags: ['performance', 'monitoring', 'prometheus'] },
  { lesson_type: 'workaround', title: 'Image processing moved to Lambda to avoid CPU spikes', content: 'Image resize in Node.js process caused CPU spikes affecting API latency. Moved to AWS Lambda triggered by S3 upload. API stays responsive.', tags: ['performance', 'aws', 'architecture'] },
  { lesson_type: 'decision', title: 'CDN cache: 1 hour for assets, no-cache for API', content: 'Static assets (JS, CSS, images) cached 1 hour with content hash in filename for busting. API responses: Cache-Control no-store. HTML: max-age=0, must-revalidate.', tags: ['performance', 'caching', 'cdn'] },

  // === Security (10) ===
  { lesson_type: 'decision', title: 'CSRF protection via SameSite cookies + double submit', content: 'Cookies set with SameSite=Lax. API also validates X-CSRF-Token header matching cookie value. Double submit pattern prevents cross-origin form attacks.', tags: ['security', 'csrf'] },
  { lesson_type: 'guardrail', title: 'SQL queries must use parameterized statements', content: 'Never concatenate user input into SQL strings. Always use $1, $2 parameters. Code review must reject any string interpolation in SQL.', tags: ['security', 'sql-injection', 'guardrail'],
    guardrail: { trigger: '/sql|query|database/', requirement: 'Use parameterized queries, never string concatenation', verification_method: 'user_confirmation' } },
  { lesson_type: 'decision', title: 'Secrets in AWS Secrets Manager, not environment variables', content: 'Production secrets (DB password, API keys) stored in AWS Secrets Manager. Application fetches at startup. Not in .env or docker-compose for production.', tags: ['security', 'secrets'] },
  { lesson_type: 'preference', title: 'Content Security Policy header on all pages', content: 'CSP header restricts script sources to self and trusted CDNs. Blocks inline scripts (nonce-based exceptions). Prevents XSS even if injection occurs.', tags: ['security', 'csp', 'xss'] },
  { lesson_type: 'workaround', title: 'JWT token stored in httpOnly cookie, not localStorage', content: 'localStorage is accessible to XSS attacks. httpOnly cookie is not readable by JavaScript. Trade-off: requires CSRF protection. Worth it for security.', tags: ['security', 'authentication', 'jwt'] },
  { lesson_type: 'general_note', title: 'Dependency audit runs weekly via Dependabot', content: 'GitHub Dependabot checks npm dependencies weekly. Critical vulnerabilities auto-create PRs. Team reviews and merges within 48 hours. npm audit in CI pipeline.', tags: ['security', 'dependencies'] },
  { lesson_type: 'decision', title: 'Input validation at API boundary, not deep in business logic', content: 'All input validated in API handler (Zod schemas) before reaching service layer. Service layer trusts input is valid. Single validation point, not scattered checks.', tags: ['security', 'validation', 'architecture'] },
  { lesson_type: 'general_note', title: 'PII data encrypted at rest in database', content: 'Columns containing PII (email, phone, address) use pgcrypto for column-level encryption. Application decrypts on read. RDS also has disk encryption enabled.', tags: ['security', 'encryption', 'pii'] },
  { lesson_type: 'preference', title: 'API keys rotated quarterly, never hardcoded', content: 'Third-party API keys stored in Secrets Manager, rotated every 90 days. Rotation script in scripts/rotate-keys.ts. Never commit keys to code, even in tests.', tags: ['security', 'api-keys'] },
  { lesson_type: 'workaround', title: 'Rate limiting bypass for health check endpoints', content: 'Health check /api/health was getting rate limited during monitoring. Fix: exclude /api/health and /api/ready from rate limiter middleware.', tags: ['security', 'rate-limiting', 'monitoring'] },

  // === Team Conventions (10) ===
  { lesson_type: 'preference', title: 'PR requires 1 approval, 2 for database changes', content: 'Standard PRs need 1 reviewer approval. PRs with migration files or schema changes need 2 approvals including a senior engineer. Auto-enforced by CODEOWNERS.', tags: ['team', 'code-review'] },
  { lesson_type: 'preference', title: 'Commit messages follow Conventional Commits', content: 'Format: type(scope): description. Types: feat, fix, refactor, docs, test, chore. Scope optional. Used for auto-generating changelogs.', tags: ['team', 'git', 'commits'] },
  { lesson_type: 'decision', title: 'Sprint length: 2 weeks with Wednesday start', content: 'Sprints run Wednesday to Tuesday. Wednesday start avoids Monday/Friday disruptions. Sprint planning Wednesday morning, retro Tuesday afternoon.', tags: ['team', 'process', 'sprints'] },
  { lesson_type: 'preference', title: 'Technical debt tracked in separate backlog column', content: 'Tech debt items go in dedicated Jira column, not mixed with features. 20% of sprint capacity allocated to tech debt. Prevents debt accumulation.', tags: ['team', 'tech-debt', 'process'] },
  { lesson_type: 'general_note', title: 'On-call rotation: 1 week per engineer, 4-person roster', content: 'Weekly rotation. On-call responds to PagerDuty alerts within 15 min during business hours, 30 min after hours. Handoff document in Notion.', tags: ['team', 'on-call'] },
  { lesson_type: 'preference', title: 'Documentation in code comments, not separate wiki', content: 'Architecture decisions in ADR files (docs/adr/). API docs auto-generated from code. Avoid separate wiki that drifts from code. README per module.', tags: ['team', 'documentation'] },
  { lesson_type: 'decision', title: 'Monorepo with npm workspaces, not separate repos', content: 'Frontend, backend, shared types in one repo with npm workspaces. Atomic changes across packages. Shared CI pipeline. Separate repos rejected for coordination overhead.', tags: ['team', 'monorepo'] },
  { lesson_type: 'preference', title: 'Feature branches from main, no develop branch', content: 'Trunk-based development: branch from main, PR back to main. No long-lived develop branch. Feature flags for work in progress. Release from main.', tags: ['team', 'git', 'branching'] },
  { lesson_type: 'general_note', title: 'Design review for any user-facing UI change', content: 'UI changes need designer review before merge. Post screenshots in #design-review Slack. Designer approves or requests changes. No formal design system yet.', tags: ['team', 'design', 'process'] },
  { lesson_type: 'preference', title: 'Error messages must be user-friendly, not technical', content: 'User-facing errors: "Unable to save your changes. Please try again." Not: "UNIQUE constraint violation on column email". Log technical detail server-side.', tags: ['team', 'ux', 'error-handling'] },

  // === Misc Knowledge (15) ===
  { lesson_type: 'general_note', title: 'Node.js 20 LTS used in production', content: 'Pinned to Node.js 20 LTS. Dockerfile uses node:20-alpine. Do not upgrade to odd-numbered versions (not LTS). Next upgrade: Node 22 LTS when stable.', tags: ['nodejs', 'version'] },
  { lesson_type: 'workaround', title: 'TypeScript path aliases break at runtime without tsconfig-paths', content: 'TS path aliases (e.g., @/services/foo) work in tsc but not at runtime. Need tsconfig-paths/register or bundler that resolves aliases. Alternatively use relative imports.', tags: ['typescript', 'debugging'] },
  { lesson_type: 'general_note', title: 'Environment variables loaded from .env via dotenv', content: 'dotenv.config() at app entry point loads .env. In production, env vars set by container orchestrator (ECS task definition), not .env file.', tags: ['nodejs', 'configuration'] },
  { lesson_type: 'workaround', title: 'Prisma client regenerate after schema change', content: 'After editing schema.prisma, must run npx prisma generate to regenerate client types. Forgetting this causes TypeScript errors on new fields. Add to pre-commit hook.', tags: ['database', 'prisma', 'tooling'] },
  { lesson_type: 'general_note', title: 'Websocket connections via Socket.io for real-time updates', content: 'Real-time features (notifications, live updates) use Socket.io. Falls back to long-polling if WebSocket blocked. Rooms per project_id for multi-tenancy.', tags: ['realtime', 'websocket'] },
  { lesson_type: 'decision', title: 'Background jobs processed by BullMQ with Redis backend', content: 'BullMQ for job queue: email sending, report generation, image processing. Redis-backed. Dashboard via bull-board at /admin/queues. Retry: 3 attempts with exponential backoff.', tags: ['queue', 'bullmq', 'redis'] },
  { lesson_type: 'workaround', title: 'Docker container timezone must be set explicitly', content: 'Alpine containers default to UTC. If app needs local timezone, set TZ=Asia/Ho_Chi_Minh in Dockerfile ENV. Or better: keep UTC everywhere, convert in frontend.', tags: ['docker', 'timezone'] },
  { lesson_type: 'general_note', title: 'Database connection string format for PostgreSQL', content: 'Format: postgresql://user:password@host:port/dbname?schema=public. For SSL: append ?sslmode=require. For connection pooling: use PgBouncer URL instead of direct.', tags: ['database', 'postgresql', 'connection'] },
  { lesson_type: 'workaround', title: 'ESLint and Prettier conflict: prettier must run last', content: 'ESLint and Prettier disagree on formatting. Fix: eslint-config-prettier disables conflicting ESLint rules. Prettier runs as last ESLint plugin via eslint-plugin-prettier.', tags: ['tooling', 'linting'] },
  { lesson_type: 'decision', title: 'Error tracking with Sentry, not custom logging', content: 'Sentry for error tracking in production. Auto-captures unhandled exceptions with stack trace, user context, breadcrumbs. Custom logging supplements but does not replace.', tags: ['monitoring', 'error-tracking', 'sentry'] },
  { lesson_type: 'general_note', title: 'Git hooks via husky: pre-commit lint, pre-push test', content: 'husky manages git hooks. Pre-commit: lint-staged runs ESLint + Prettier on staged files. Pre-push: runs unit tests. Prevents committing broken or unformatted code.', tags: ['git', 'tooling', 'hooks'] },
  { lesson_type: 'workaround', title: 'npm ci instead of npm install in CI for reproducible builds', content: 'npm ci installs exact versions from package-lock.json, removes node_modules first. Faster and deterministic. npm install may update lock file unexpectedly.', tags: ['ci', 'npm', 'tooling'] },
  { lesson_type: 'general_note', title: 'API documentation auto-generated from Zod schemas', content: 'Zod schemas generate OpenAPI spec via zod-to-openapi. Swagger UI at /api/docs. Docs always match code because they are generated from the same schemas.', tags: ['api', 'documentation'] },
  { lesson_type: 'decision', title: 'Logging levels: debug for dev, info for production', content: 'LOG_LEVEL=debug in development (verbose). LOG_LEVEL=info in production (operations). ERROR for failures only. WARN for degraded but functioning state.', tags: ['logging', 'configuration'] },
  { lesson_type: 'general_note', title: 'Health check endpoint returns DB and Redis status', content: '/api/health returns { status: ok/degraded, db: connected, redis: connected, uptime_seconds }. Used by ECS health check and monitoring. Returns 503 if critical service down.', tags: ['monitoring', 'health-check'] },
];

async function main() {
  const client = new Client({ name: 'seed-random', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), {}));

  console.log(`Seeding ${LESSONS.length} additional lessons...\n`);
  let ok = 0, fail = 0;
  for (const l of LESSONS) {
    const r = await call(client, 'add_lesson', { lesson_payload: { project_id: PID, ...l }, output_format: 'json_only' }) as any;
    if (r?.lesson_id) ok++;
    else { fail++; console.log(`  WARN: "${l.title.slice(0, 50)}"`); }
  }
  console.log(`Seeded: ${ok}/${LESSONS.length} (${fail} failed)`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
