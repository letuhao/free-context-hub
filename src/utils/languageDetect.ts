/**
 * Language detection, test detection, and chunk kind classification from file path.
 * Workspace-agnostic: works for any codebase.
 *
 * Chunk kinds are designed for coder agent search — each kind represents
 * a distinct type of content that agents search for with different intents:
 *
 *   source     - Implementation code (functions, classes, handlers, business logic)
 *   type_def   - Type/interface/model definitions, struct declarations, enums
 *   test       - Test files (unit, integration, e2e, fixtures, mocks)
 *   migration  - Database migrations, SQL schema definitions, seed data
 *   config     - App configuration (.env, yaml config, json settings)
 *   dependency - Package manifests (package.json, go.mod, Cargo.toml, requirements.txt, lock files)
 *   api_spec   - API definitions (OpenAPI, GraphQL schema, protobuf, gRPC)
 *   doc        - Documentation (markdown, guides, changelogs, READMEs, whitepapers)
 *   script     - Utility/build/seed scripts (not core application logic)
 *   infra      - CI/CD pipelines, Docker, Terraform, K8s, deployment configs
 *   style      - CSS/SCSS/LESS/styling files
 *   generated  - Auto-generated files (lock files, codegen output, compiled assets)
 */

export type ChunkKind =
  | 'source'
  | 'type_def'
  | 'test'
  | 'migration'
  | 'config'
  | 'dependency'
  | 'api_spec'
  | 'doc'
  | 'script'
  | 'infra'
  | 'style'
  | 'generated';

/** All valid chunk kinds, exported for schema validation. */
export const ALL_CHUNK_KINDS: readonly ChunkKind[] = [
  'source', 'type_def', 'test', 'migration', 'config', 'dependency',
  'api_spec', 'doc', 'script', 'infra', 'style', 'generated',
] as const;

export type LanguageInfo = {
  language: string;
  isTest: boolean;
  /** Classification of the file for targeted search pipelines. */
  kind: ChunkKind;
};

// ─── Language Detection ──────────────────────────────────────────────────

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.pyw': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin', '.kts': 'kotlin',
  '.rb': 'ruby',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp',
  '.c': 'c', '.h': 'c',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.scala': 'scala',
  '.php': 'php',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.lua': 'lua',
  '.zig': 'zig',
  '.ex': 'elixir', '.exs': 'elixir',
  '.erl': 'erlang',
  '.hs': 'haskell',
  '.ml': 'ocaml', '.mli': 'ocaml',
  '.dart': 'dart',
  '.r': 'r', '.R': 'r',
  '.sql': 'sql',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.ps1': 'powershell',
  '.yml': 'yaml', '.yaml': 'yaml',
  '.json': 'json',
  '.toml': 'toml',
  '.xml': 'xml',
  '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.md': 'markdown', '.mdx': 'markdown',
  '.txt': 'text',
  '.rst': 'rst',
  '.proto': 'protobuf',
  '.graphql': 'graphql', '.gql': 'graphql',
  '.tf': 'terraform', '.tfvars': 'terraform',
  '.dockerfile': 'dockerfile',
};

// ─── Classification Patterns ─────────────────────────────────────────────

// Tests: unit, integration, e2e, fixtures, mocks
const TEST_PATTERNS = [
  /\.test\.\w+$/,
  /\.spec\.\w+$/,
  /_test\.\w+$/,
  /\.tests\.\w+$/,
  /\btest[s]?\//i,
  /\b__tests__\//,
  /\bspec[s]?\//i,
  /\bfixture[s]?\//i,
  /\b__mocks__\//,
  /\be2e\//i,
  /\bcypress\//i,
  /\bplaywright\//i,
];

// Type definitions: files that primarily define types/interfaces/models
const TYPE_DEF_PATTERNS = [
  /\.d\.ts$/,                    // TypeScript declaration files
  /\.d\.mts$/,
  /\.types?\.\w+$/,              // *.type.ts, *.types.ts
  /\btypes?\//,                  // types/ directory
  /\binterfaces?\//,             // interfaces/ directory
  /\bmodels?\//,                 // models/ directory
  /\bschemas?\//,                // schemas/ directory (non-DB)
  /\bentities?\//,               // entities/ directory
  /\bdto\//i,                    // dto/ directory
  /\.proto$/,                    // protobuf definitions → also api_spec
];

// Database migrations and schema files
const MIGRATION_PATTERNS = [
  /\bmigrations?\//,             // migrations/ directory
  /\bdb\/migrate/,               // db/migrate/
  /\balembic\//,                 // Python Alembic
  /\bknex.*migrations?\//,       // Knex.js
  /\bprisma\/migrations?\//,     // Prisma
  /\bseed[s]?\.\w+$/,           // seed files
  /\bseed[s]?\//,               // seeds/ directory
  /\bflyway\//,                 // Flyway
  /\bliquibase\//,              // Liquibase
  /\.sql$/,                     // standalone SQL files (context matters)
];

// API specification files
const API_SPEC_PATTERNS = [
  /\bopenapi\b/i,               // openapi.yaml, openapi.json
  /\bswagger\b/i,               // swagger.yaml
  /\.proto$/,                   // protobuf
  /\.graphql$/,                 // GraphQL schemas
  /\.gql$/,
  /\bapi[-_]?spec/i,           // api-spec/ or api_spec
  /\bschema\.graphql$/,
];

// Documentation
const DOC_PATTERNS = [
  /\.(md|mdx|txt|rst|adoc|rdoc)$/,
  /^(docs?|documentation|wiki|guides?|tutorials?)\//,
  /(README|CHANGELOG|LICENSE|CONTRIBUTING|WHITEPAPER|CLAUDE|AUTHORS|HISTORY|NEWS)\b/i,
  /\bADR[-_]\d/i,              // Architecture Decision Records
];

// Configuration files
const CONFIG_PATTERNS = [
  /\.(env|ini|cfg|conf|properties)$/,
  /\.(env\.example|env\.local|env\.development|env\.production|env\.test)$/,
  /\bconfig\.\w+$/,             // config.ts, config.yaml
  /\bsettings\.\w+$/,           // settings.py
  /^\.[\w.-]+rc(\.[\w]+)?$/,    // .eslintrc, .prettierrc.json
  /\btsconfig.*\.json$/,        // tsconfig.json, tsconfig.build.json
  /\bjest\.config/,             // jest.config.ts
  /\bvitest\.config/,           // vitest.config.ts
  /\bwebpack\.config/,          // webpack.config.js
  /\bvite\.config/,             // vite.config.ts
  /\bnext\.config/,             // next.config.js
  /\btailwind\.config/,         // tailwind.config.js
  /\bbabel\.config/,
  /\b\.env\b/,
];

// Dependency manifests and lock files
const DEPENDENCY_PATTERNS = [
  /\bpackage\.json$/,           // npm
  /\bpackage-lock\.json$/,      // npm lock
  /\byarn\.lock$/,              // yarn lock
  /\bpnpm-lock\.yaml$/,         // pnpm lock
  /\bGemfile$/,                 // Ruby
  /\bGemfile\.lock$/,
  /\brequirements.*\.txt$/,     // Python pip
  /\bPipfile$/,                 // Python Pipenv
  /\bPipfile\.lock$/,
  /\bpyproject\.toml$/,         // Python modern
  /\bpoetry\.lock$/,
  /\bsetup\.py$/,               // Python legacy
  /\bsetup\.cfg$/,
  /\bgo\.mod$/,                 // Go
  /\bgo\.sum$/,                 // Go checksum
  /\bCargo\.toml$/,             // Rust
  /\bCargo\.lock$/,
  /\bcomposer\.json$/,          // PHP
  /\bcomposer\.lock$/,
  /\bbuild\.gradle/,            // Java/Kotlin Gradle
  /\bpom\.xml$/,                // Java Maven
  /\b\.gemspec$/,               // Ruby gem
  /\bMix\.exs$/,                // Elixir
  /\bPodfile$/,                 // iOS CocoaPods
  /\bPodfile\.lock$/,
  /\bSPM|Package\.swift$/,      // Swift Package Manager
];

// Infrastructure / CI / deployment
const INFRA_PATTERNS = [
  /\bDockerfile/i,
  /\bdocker-compose/i,
  /\bMakefile$/,
  /\bJenkinsfile$/i,
  /\bVagrantfile$/i,
  /\b\.github\/workflows?\//,   // GitHub Actions
  /\b\.gitlab-ci/,              // GitLab CI
  /\b\.circleci\//,             // CircleCI
  /\b\.travis\.yml$/,           // Travis CI
  /\bbitbucket-pipelines/,      // Bitbucket
  /\bazure-pipelines/i,         // Azure DevOps
  /\b\.tf$/,                    // Terraform
  /\b\.tfvars$/,
  /\bkubernetes?\//i,           // Kubernetes
  /\bk8s\//i,
  /\bhelm\//i,                  // Helm charts
  /\bansible\//i,               // Ansible
  /\bdeploy\//i,                // deploy/ directory
  /\binfra\//i,                 // infra/ directory
  /\b\.pulumi\//,               // Pulumi
  /\bserverless\.yml$/,         // Serverless Framework
];

// Script files (utility, build, seed — not core application logic)
const SCRIPT_PATTERNS = [
  /\bscripts?\//,               // scripts/ directory
  /\bbin\//,                    // bin/ directory
  /\btools?\//,                 // tools/ directory
  /\bhooks?\//,                 // hooks/ directory (git hooks, etc.)
  /\btasks?\//,                 // tasks/ directory
];

// Style files
const STYLE_PATTERNS = [
  /\.css$/,
  /\.scss$/,
  /\.sass$/,
  /\.less$/,
  /\.styl$/,
  /\.stylus$/,
  /\bstyles?\//,                // styles/ directory
];

// Generated / auto-generated files
const GENERATED_PATTERNS = [
  /\.lock$/,                    // all lock files
  /\.generated\.\w+$/,          // *.generated.ts
  /\bgenerated\//,              // generated/ directory
  /\b__generated__\//,
  /\bdist\//,                   // build output
  /\bbuild\//,                  // build output
  /\.min\.\w+$/,                // minified files
  /\.map$/,                     // source maps
  /\bcodegen\//,                // codegen output
  /\.pb\.\w+$/,                 // protobuf generated
  /_pb2\.py$/,                  // protobuf Python
  /\.swagger\.\w+$/,            // generated swagger
];

// ─── Main Detection Function ─────────────────────────────────────────────

export function detectLanguage(filePath: string): LanguageInfo {
  const normalized = filePath.replace(/\\/g, '/');
  const normalizedLower = normalized.toLowerCase();
  const ext = getExtension(normalizedLower);
  let language = EXT_TO_LANGUAGE[ext] ?? '';

  // Dockerfile special case (no extension).
  if (!language && /(?:^|\/)?dockerfile/i.test(normalized)) {
    language = 'dockerfile';
  }

  const isTest = TEST_PATTERNS.some(p => p.test(normalizedLower));
  const kind = classifyKind(normalized, normalizedLower, language, isTest);

  return { language, isTest, kind };
}

/**
 * Classify a file into a chunk kind based on path, language, and test status.
 *
 * Priority order (first match wins):
 *   generated > test > migration > api_spec > type_def > dependency >
 *   doc > style > config > infra > script > source
 *
 * The order ensures specific kinds are detected before falling through
 * to the broad "source" bucket.
 */
function classifyKind(
  path: string,         // original case preserved (for case-sensitive patterns like README)
  pathLower: string,    // lowercased for case-insensitive matching
  language: string,
  isTest: boolean,
): ChunkKind {

  // ── Generated (highest priority — never want in normal search) ────
  if (GENERATED_PATTERNS.some(p => p.test(pathLower))) return 'generated';

  // ── Tests ────────────────────────────────────────────────────────
  if (isTest) return 'test';

  // ── Database Migrations ──────────────────────────────────────────
  // SQL files in migration directories, seed files
  if (MIGRATION_PATTERNS.some(p => p.test(pathLower))) return 'migration';

  // ── API Specifications ───────────────────────────────────────────
  // OpenAPI, GraphQL schemas, protobuf definitions
  if (API_SPEC_PATTERNS.some(p => p.test(pathLower))) return 'api_spec';

  // ── Type Definitions ─────────────────────────────────────────────
  // .d.ts files, types/ directories, models/ directories
  if (TYPE_DEF_PATTERNS.some(p => p.test(pathLower))) return 'type_def';

  // ── Dependencies (before config, since package.json is both) ─────
  if (DEPENDENCY_PATTERNS.some(p => p.test(path))) return 'dependency';

  // ── Documentation ────────────────────────────────────────────────
  if (language === 'markdown' || language === 'text' || language === 'rst' ||
      DOC_PATTERNS.some(p => p.test(path))) return 'doc';

  // ── Styles ───────────────────────────────────────────────────────
  if (language === 'css' || language === 'scss' || language === 'less' ||
      STYLE_PATTERNS.some(p => p.test(pathLower))) return 'style';

  // ── Configuration ────────────────────────────────────────────────
  // JSON/YAML/TOML that aren't already caught as dependency/api_spec
  if (CONFIG_PATTERNS.some(p => p.test(path))) return 'config';
  if (['json', 'yaml', 'toml', 'xml'].includes(language)) return 'config';

  // ── Infrastructure / CI / Deployment ─────────────────────────────
  if (language === 'dockerfile' || language === 'terraform' ||
      INFRA_PATTERNS.some(p => p.test(pathLower))) return 'infra';

  // ── Scripts (utility scripts, not core application logic) ────────
  // Shell/PowerShell files, and files in scripts/ directory
  if (language === 'shell' || language === 'powershell' ||
      SCRIPT_PATTERNS.some(p => p.test(pathLower))) return 'script';

  // ── Source Code (default — actual implementation) ────────────────
  return 'source';
}

function getExtension(filePath: string): string {
  const base = filePath.split('/').pop() ?? '';
  // Handle compound extensions like .d.ts, .test.ts
  const dtsMatch = base.match(/\.d\.(ts|mts|cts)$/);
  if (dtsMatch) return `.d.${dtsMatch[1]}`;
  const dotIdx = base.lastIndexOf('.');
  if (dotIdx <= 0) return '';
  return base.slice(dotIdx);
}
