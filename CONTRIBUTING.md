# Contributing to free-context-hub

Thanks for your interest in contributing! This project is a self-hosted MCP server
for AI-agent memory, search, and guardrails. Contributions of all kinds are welcome —
bug reports, fixes, docs, and features.

## Code of Conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you
agree to uphold it. Please report unacceptable behavior to the maintainer.

## Ways to contribute

- **Report a bug** — open an issue using the Bug Report template.
- **Request a feature** — open an issue using the Feature Request template.
- **Improve docs** — typos, clarifications, and missing setup steps are all valuable.
- **Submit a fix or feature** — see the development workflow below.

## Development setup

**Prerequisites:** Node.js 20+, Docker, and an OpenAI-compatible embeddings endpoint
(e.g. [LM Studio](https://lmstudio.ai/)). See the [Quickstart](docs/QUICKSTART.md) for
the full walkthrough.

```bash
git clone https://github.com/letuhao/free-context-hub.git
cd free-context-hub
npm install

cp .env.example .env          # set DATABASE_URL and EMBEDDINGS_BASE_URL
docker compose up -d          # Postgres + pgvector (+ optional services)

npm run dev                   # MCP :3000 + REST API :3001
npm run smoke-test            # verify the stack is healthy

cd gui && npm install && npm run dev   # optional GUI on :3002
```

## Testing

Evidence before claims — run tests fresh before opening a PR.

```bash
npm run build           # TypeScript typecheck (no external services needed)
npm test                # unit tests (needs Postgres + embeddings endpoint)
npm run test:e2e        # full e2e suite (needs the live stack up)
```

The e2e suites (`test:e2e:smoke`, `:api`, `:gui`, `:agent`) run against a live
`docker compose` stack. In CI a mock embeddings server stands in for LM Studio
(`scripts/ci-mock-embeddings.mjs`).

## Pull request workflow

1. **Branch from `main`.** This is a trunk-based repo — keep branches short-lived and
   focused on one change. Avoid cutting two parallel branches that touch the same files.
2. **Keep changes scoped.** One logical change per PR. Unrelated cleanups belong in
   their own PR.
3. **Add or update tests** for any behavior change. Bug fixes should include a test that
   fails before the fix and passes after.
4. **Run the relevant tests** and paste the output in the PR description.
5. **Update docs** (`README.md`, `docs/`, `CHANGELOG.md`) when behavior or setup changes.
6. **Fill out the PR template** completely, including how you verified the change.

Maintainers may ask for changes — that's normal and not a judgment on the work.

## Commit messages

- Write clear, present-tense subject lines (`Fix off-by-one in pagination offset`).
- Reference issues where relevant (`Fixes #123`).
- Group logically related changes into a single commit where it aids review.

## Reporting security issues

**Do not open a public issue for security vulnerabilities.** Follow the process in
[SECURITY.md](SECURITY.md) instead.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE) that covers this project.
