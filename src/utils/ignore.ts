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

  return [...DEFAULT_SECRET_IGNORE_PATTERNS, ...userPatterns].map(normalizePattern);
}

