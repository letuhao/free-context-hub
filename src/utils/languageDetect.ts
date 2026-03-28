/**
 * Language detection, test detection, and chunk kind classification from file path.
 * Workspace-agnostic: works for any codebase.
 */

export type ChunkKind = 'code' | 'doc' | 'config' | 'test' | 'infra';

export type LanguageInfo = {
  language: string;
  isTest: boolean;
  /** Classification of the file for targeted search pipelines. */
  kind: ChunkKind;
};

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
  '.md': 'markdown',
  '.proto': 'protobuf',
  '.graphql': 'graphql', '.gql': 'graphql',
  '.tf': 'terraform', '.tfvars': 'terraform',
  '.dockerfile': 'dockerfile',
};

/** Languages that produce actual executable/compilable code. */
const CODE_LANGUAGES = new Set([
  'typescript', 'javascript', 'python', 'go', 'rust', 'java', 'kotlin',
  'ruby', 'cpp', 'c', 'csharp', 'swift', 'scala', 'php', 'vue', 'svelte',
  'lua', 'zig', 'elixir', 'erlang', 'haskell', 'ocaml', 'dart', 'r',
  'sql', 'protobuf', 'graphql', 'html', 'css', 'scss', 'less',
]);

/** Languages/formats that are configuration. */
const CONFIG_LANGUAGES = new Set([
  'json', 'yaml', 'toml', 'xml',
]);

/** Languages/formats that are infrastructure/scripting. */
const INFRA_LANGUAGES = new Set([
  'shell', 'powershell', 'dockerfile', 'terraform',
]);

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
];

const DOC_PATTERNS = [
  /\.(md|txt|rst|adoc|rdoc)$/,
  /^(docs?|documentation|wiki|guides?)\//,
  /(README|CHANGELOG|LICENSE|CONTRIBUTING|WHITEPAPER|CLAUDE)\./i,
];

const CONFIG_PATH_PATTERNS = [
  /\.(env|ini|cfg|conf|properties)$/,
  /(tsconfig|package|composer|Cargo|go\.mod|go\.sum|Gemfile|Pipfile|pyproject)\b/,
  /^\./,  // dotfiles (.eslintrc, .prettierrc, etc.)
];

const INFRA_PATH_PATTERNS = [
  /(Dockerfile|docker-compose|Makefile|Jenkinsfile|Vagrantfile)\b/,
  /^(\.(github|gitlab|circleci)|scripts?|ci|deploy|infra)\//,
];

export function detectLanguage(filePath: string): LanguageInfo {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const ext = getExtension(normalized);
  let language = EXT_TO_LANGUAGE[ext] ?? '';

  // Dockerfile special case
  if (!language && /(?:^|\/)?dockerfile/i.test(normalized)) {
    language = 'dockerfile';
  }

  const isTest = TEST_PATTERNS.some(p => p.test(normalized));
  const kind = classifyKind(normalized, language, isTest);

  return { language, isTest, kind };
}

/**
 * Classify a file into a chunk kind based on path, language, and test status.
 * Priority: test > doc > config > infra > code
 */
function classifyKind(normalizedPath: string, language: string, isTest: boolean): ChunkKind {
  // Tests are always tests, regardless of language.
  if (isTest) return 'test';

  // Documentation files.
  if (language === 'markdown' || DOC_PATTERNS.some(p => p.test(normalizedPath))) return 'doc';

  // Config files (by language or path pattern).
  if (CONFIG_LANGUAGES.has(language) || CONFIG_PATH_PATTERNS.some(p => p.test(normalizedPath))) return 'config';

  // Infrastructure/CI/scripts.
  if (INFRA_LANGUAGES.has(language) || INFRA_PATH_PATTERNS.some(p => p.test(normalizedPath))) return 'infra';

  // Everything else is code.
  return 'code';
}

function getExtension(filePath: string): string {
  const base = filePath.split('/').pop() ?? '';
  const dotIdx = base.lastIndexOf('.');
  if (dotIdx <= 0) return '';
  return base.slice(dotIdx);
}
