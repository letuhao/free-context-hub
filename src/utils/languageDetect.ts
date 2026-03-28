/**
 * Language detection and metadata from file extension.
 * Workspace-agnostic: works for any codebase.
 */

export type LanguageInfo = {
  language: string;
  isTest: boolean;
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

const TEST_PATTERNS = [
  /\.test\.\w+$/,
  /\.spec\.\w+$/,
  /_test\.\w+$/,
  /\.tests\.\w+$/,
  /\btest[s]?\//i,
  /\b__tests__\//,
  /\bspec[s]?\//i,
  /\bfixture[s]?\//i,
];

export function detectLanguage(filePath: string): LanguageInfo {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const ext = getExtension(normalized);
  const language = EXT_TO_LANGUAGE[ext] ?? '';

  // Dockerfile special case
  if (!language && /(?:^|\/)?dockerfile/i.test(normalized)) {
    return { language: 'dockerfile', isTest: false };
  }

  const isTest = TEST_PATTERNS.some(p => p.test(normalized));

  return { language, isTest };
}

function getExtension(filePath: string): string {
  const base = filePath.split('/').pop() ?? '';
  const dotIdx = base.lastIndexOf('.');
  if (dotIdx <= 0) return '';
  return base.slice(dotIdx);
}
