-- Classify chunks into kinds for targeted search pipelines.
-- code:    actual source code (.ts, .js, .py, .go, etc.)
-- doc:     documentation files (.md, .txt, .rst, etc.)
-- config:  configuration files (.json, .yaml, .toml, .env, etc.)
-- test:    test files (*.test.*, *.spec.*, __tests__/*)
-- infra:   CI/CD, Docker, Terraform, scripts
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS chunk_kind TEXT;

-- Backfill based on existing metadata.
-- Tests first (most specific), then by language/path.
UPDATE chunks SET chunk_kind = 'test'
WHERE chunk_kind IS NULL AND (is_test = true OR file_path ~ '\.(test|spec)\.\w+$' OR file_path ~ '(__tests__|__mocks__|fixtures?|test[s]?)/' );

UPDATE chunks SET chunk_kind = 'doc'
WHERE chunk_kind IS NULL AND (
  language IN ('markdown') OR
  file_path ~ '\.(md|txt|rst|adoc|rdoc)$' OR
  file_path ~ '^(docs?|documentation|wiki|guides?)/' OR
  file_path ~ '(README|CHANGELOG|LICENSE|CONTRIBUTING|WHITEPAPER|CLAUDE)\.'
);

UPDATE chunks SET chunk_kind = 'config'
WHERE chunk_kind IS NULL AND (
  language IN ('json', 'yaml', 'toml', 'xml') OR
  file_path ~ '\.(env|ini|cfg|conf|properties)$' OR
  file_path ~ '(tsconfig|package|composer|Cargo|go\.mod|go\.sum|Gemfile|Pipfile|pyproject)' OR
  file_path ~ '^\.' -- dotfiles
);

UPDATE chunks SET chunk_kind = 'infra'
WHERE chunk_kind IS NULL AND (
  language IN ('dockerfile', 'terraform', 'shell', 'powershell') OR
  file_path ~ '(Dockerfile|docker-compose|Makefile|Jenkinsfile|Vagrantfile)' OR
  file_path ~ '^(\.github|\.gitlab|\.circleci|scripts?|ci|deploy|infra)/' OR
  file_path ~ '\.(sh|bash|zsh|ps1|bat|cmd)$'
);

-- Everything else is code.
UPDATE chunks SET chunk_kind = 'code' WHERE chunk_kind IS NULL;

-- Index for fast kind-filtered queries.
CREATE INDEX IF NOT EXISTS idx_chunks_kind ON chunks(project_id, chunk_kind);
-- Composite index for code-specific symbol lookups.
CREATE INDEX IF NOT EXISTS idx_chunks_symbol_kind ON chunks(project_id, chunk_kind, symbol_name) WHERE symbol_name IS NOT NULL;
