import fs from 'node:fs/promises';
import path from 'node:path';

function normalizePattern(p: string) {
  return p.trim().replaceAll('\\', '/');
}

const DEFAULT_SECRET_IGNORE_PATTERNS: string[] = [
  '**/.env',
  '**/.env.*',
  '**/*.key',
  '**/*.pem',
  '**/*credentials*',
  '**/credentials.json',
  '**/*credential*',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/Cargo.lock',
  '**/Gemfile.lock',
];

/**
 * Sprint 12.0.2 — build-output + agent-metadata + misc noise patterns.
 *
 * Added after the 12.0.1 index-hygiene finding: first-time indexing of
 * `free-context-hub` ingested 4426 junk chunks (dist/, gui/.next/,
 * .claude/worktrees/, test-results/, coverage/). None carried secrets,
 * but they diluted retrieval relevance and inflated latency.
 *
 * WHO CONSUMES THIS LIST (Sprint 12.0.2 /review-impl MED-2):
 * These patterns flow through `loadIgnorePatternsFromRoot()` which is
 * called by THREE services — src/services/indexer.ts,
 * src/services/builderMemoryLarge.ts (repo line-count estimation), and
 * src/services/gitIntelligence.ts (git history analysis). Changing the
 * defaults affects all three; for this sprint the widened scope is
 * desired (none of the three wants compiled dist/ output in its corpus).
 *
 * PATTERN-SCOPE DISCIPLINE (Sprint 12.0.2 /review-impl MED-3):
 * `out/` and `build/` patterns are ROOT-ONLY (no leading globstar).
 * This prevents false exclusion when a user project has legitimate
 * content at nested paths like `docs/out/schemas/` or `tests/build-data/`.
 * The common build-output case (`<project>/out/`, `<project>/build/`)
 * is still caught. `target/` stays deep because it is idiomatic for
 * Rust/Java only at the project root — any deep `target/` is almost
 * certainly a build artifact regardless of project type.
 *
 * Projects can still add more via their .contexthub/ignore file.
 */
const DEFAULT_BUILD_OUTPUT_IGNORE_PATTERNS: string[] = [
  // Compiled/transpiled output — root-only to avoid deep false-exclusions
  'dist/**',
  'build/**',
  'out/**',
  // Also catch `gui/dist/**`, `packages/*/dist/**` etc. — monorepos are common
  '**/dist/**',
  // But NOT '**/build/**' / '**/out/**' — those names collide with legitimate
  // user paths (docs/build/, tests/out/, etc.). Monorepo build dirs that need
  // exclusion should add their path to .contexthub/ignore.
  // Next.js / SvelteKit / Turbo / Nuxt — deep match OK (framework-scoped names)
  '**/.next/**',
  '**/.svelte-kit/**',
  '**/.turbo/**',
  '**/.nuxt/**',
  // Rust / Java / Kotlin
  '**/target/**',
  // Python
  '**/__pycache__/**',
  '**/*.pyc',
  // Agent/IDE workspace metadata
  '**/.claude/**',
  '**/.cursor/**',
  '**/.idea/**',
  // Test / coverage output
  '**/test-results/**',
  '**/playwright-report/**',
  '**/coverage/**',
  '**/.nyc_output/**',
  // Log / minified / map files
  '**/*.log',
  '**/*.map',
  '**/*.min.js',
  '**/*.min.css',
  // OS
  '**/.DS_Store',
  '**/Thumbs.db',
];

export async function loadIgnorePatternsFromRoot(root: string): Promise<string[]> {
  const ignoreFile = path.join(root, '.contexthub', 'ignore');
  let userPatterns: string[] = [];

  try {
    const raw = await fs.readFile(ignoreFile, 'utf8');
    userPatterns = raw
      .split(/\r?\n/g)
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'))
      .map(normalizePattern);
  } catch {
    // If ignore file doesn't exist, we just use defaults.
  }

  return [
    ...DEFAULT_SECRET_IGNORE_PATTERNS,
    ...DEFAULT_BUILD_OUTPUT_IGNORE_PATTERNS,
    ...userPatterns,
  ].map(normalizePattern);
}

