-- Refine chunk_kind from 5 kinds to 12 kinds for more precise coder agent search.
--
-- New kinds: source, type_def, test, migration, config, dependency,
--            api_spec, doc, script, infra, style, generated
--
-- Priority order (applied top-to-bottom, first match wins):

-- Reset all to NULL to re-classify.
UPDATE chunks SET chunk_kind = NULL;

-- 1. Generated files (lock files, build output, codegen)
UPDATE chunks SET chunk_kind = 'generated'
WHERE chunk_kind IS NULL AND (
  file_path ~ '\.lock$' OR
  file_path ~ '\.generated\.\w+$' OR
  file_path ~ '(^|/)generated/' OR
  file_path ~ '(^|/)__generated__/' OR
  file_path ~ '(^|/)dist/' OR
  file_path ~ '\.min\.\w+$' OR
  file_path ~ '\.map$'
);

-- 2. Tests
UPDATE chunks SET chunk_kind = 'test'
WHERE chunk_kind IS NULL AND (
  is_test = true OR
  file_path ~ '\.(test|spec)\.\w+$' OR
  file_path ~ '_test\.\w+$' OR
  file_path ~ '(^|/)(test[s]?|__tests__|__mocks__|spec[s]?|fixture[s]?|e2e|cypress|playwright)/'
);

-- 3. Database migrations and seed data
UPDATE chunks SET chunk_kind = 'migration'
WHERE chunk_kind IS NULL AND (
  file_path ~ '(^|/)migrations?/' OR
  file_path ~ '(^|/)db/migrate' OR
  file_path ~ '(^|/)alembic/' OR
  file_path ~ '(^|/)prisma/migrations?/' OR
  file_path ~ '(^|/)seed[s]?\.\w+$' OR
  file_path ~ '(^|/)seed[s]?/' OR
  file_path ~ '(^|/)flyway/' OR
  file_path ~ '(^|/)liquibase/'
);

-- 4. API specifications
UPDATE chunks SET chunk_kind = 'api_spec'
WHERE chunk_kind IS NULL AND (
  file_path ~* 'openapi' OR
  file_path ~* 'swagger' OR
  language IN ('protobuf', 'graphql') OR
  file_path ~ '\.proto$' OR
  file_path ~ '\.graphql$' OR
  file_path ~ '\.gql$' OR
  file_path ~* 'api[-_]?spec'
);

-- 5. Type definitions
UPDATE chunks SET chunk_kind = 'type_def'
WHERE chunk_kind IS NULL AND (
  file_path ~ '\.d\.ts$' OR
  file_path ~ '\.d\.mts$' OR
  file_path ~ '\.types?\.\w+$' OR
  file_path ~ '(^|/)types?/' OR
  file_path ~ '(^|/)interfaces?/' OR
  file_path ~ '(^|/)models?/' OR
  file_path ~ '(^|/)schemas?/' OR
  file_path ~ '(^|/)entities?/' OR
  file_path ~ '(^|/)dto/'
);

-- 6. Dependencies (package manifests)
UPDATE chunks SET chunk_kind = 'dependency'
WHERE chunk_kind IS NULL AND (
  file_path ~ '(^|/)package\.json$' OR
  file_path ~ '(^|/)Gemfile$' OR
  file_path ~ '(^|/)requirements.*\.txt$' OR
  file_path ~ '(^|/)Pipfile$' OR
  file_path ~ '(^|/)pyproject\.toml$' OR
  file_path ~ '(^|/)setup\.(py|cfg)$' OR
  file_path ~ '(^|/)go\.mod$' OR
  file_path ~ '(^|/)go\.sum$' OR
  file_path ~ '(^|/)Cargo\.toml$' OR
  file_path ~ '(^|/)composer\.json$' OR
  file_path ~ '(^|/)build\.gradle' OR
  file_path ~ '(^|/)pom\.xml$' OR
  file_path ~ '(^|/)\.gemspec$' OR
  file_path ~ '(^|/)Mix\.exs$' OR
  file_path ~ '(^|/)Package\.swift$'
);

-- 7. Documentation
UPDATE chunks SET chunk_kind = 'doc'
WHERE chunk_kind IS NULL AND (
  language IN ('markdown', 'text', 'rst') OR
  file_path ~ '\.(md|mdx|txt|rst|adoc|rdoc)$' OR
  file_path ~ '(^|/)(docs?|documentation|wiki|guides?|tutorials?)/' OR
  file_path ~ '(README|CHANGELOG|LICENSE|CONTRIBUTING|WHITEPAPER|CLAUDE|AUTHORS|HISTORY|NEWS)\.'
);

-- 8. Styles (CSS, SCSS, etc.)
UPDATE chunks SET chunk_kind = 'style'
WHERE chunk_kind IS NULL AND (
  language IN ('css', 'scss', 'less') OR
  file_path ~ '\.(css|scss|sass|less|styl|stylus)$' OR
  file_path ~ '(^|/)styles?/'
);

-- 9. Configuration (JSON/YAML/TOML that aren't already caught)
UPDATE chunks SET chunk_kind = 'config'
WHERE chunk_kind IS NULL AND (
  language IN ('json', 'yaml', 'toml', 'xml') OR
  file_path ~ '\.(env|ini|cfg|conf|properties)$' OR
  file_path ~ '(tsconfig|jest\.config|vitest\.config|webpack\.config|vite\.config|babel\.config|next\.config|tailwind\.config)' OR
  file_path ~ '^\.[\w.-]+rc'
);

-- 10. Infrastructure / CI / Deployment
UPDATE chunks SET chunk_kind = 'infra'
WHERE chunk_kind IS NULL AND (
  language IN ('dockerfile', 'terraform') OR
  file_path ~ '(Dockerfile|docker-compose|Makefile|Jenkinsfile|Vagrantfile)' OR
  file_path ~ '(^|/)(\.github|\.gitlab|\.circleci|deploy|infra|kubernetes|k8s|helm|ansible)/' OR
  file_path ~ '\.(tf|tfvars)$' OR
  file_path ~ '(travis\.yml|bitbucket-pipelines|azure-pipelines|serverless\.yml)$'
);

-- 11. Scripts (utility, build, seed — not core logic)
UPDATE chunks SET chunk_kind = 'script'
WHERE chunk_kind IS NULL AND (
  language IN ('shell', 'powershell') OR
  file_path ~ '(^|/)(scripts?|bin|tools?|hooks?|tasks?)/' OR
  file_path ~ '\.(sh|bash|zsh|ps1|bat|cmd)$'
);

-- 12. Source code (everything else — the actual implementation)
UPDATE chunks SET chunk_kind = 'source' WHERE chunk_kind IS NULL;
