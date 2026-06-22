# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0 releases (including 0.1.x) may introduce breaking API or configuration
changes between minor versions. Pin to a specific release tag for production
deployments until 1.0.0.

## [Unreleased]

## [0.1.0] - 2026-06-22

First public MVP release — self-hosted persistent memory, semantic search, and
guardrails for MCP AI coding agents, with a human-in-the-loop GUI.

### Added

- **Persistent lessons** — store decisions, preferences, workarounds, and guardrails
  with semantic search backed by PostgreSQL 16 and pgvector
- **Guardrails** — pre-action policy checks for agents via MCP and REST, with audit logging
- **MCP server** — 104 tools for lessons, search, guardrails, code navigation, git
  intelligence, knowledge graph, coordination, governance, jobs, and project context (port 3000)
- **REST API** — ~95 endpoints across 37 route files for the GUI and integrations (port 3001)
- **Human-in-the-loop GUI** — Next.js 16 web app (port 3002) with 20 pages: dashboard,
  chat, lessons, review inbox, analytics, documents, agents, settings, and more
- **Tiered code search** — ripgrep → full-text → semantic retrieval with optional reranking
- **Git ingestion** — commit history analysis and lesson suggestions from repository activity
- **Optional Neo4j knowledge graph** — symbol extraction and dependency tracing when enabled
- **Multi-project support** — project selector, cross-project views, and tenant-scope enforcement
- **Access control** — API keys, roles, and role-based middleware for MCP and REST
- **Knowledge portability** — zip + JSONL bundle export/import with conflict policies
- **Multi-format document ingestion** — PDF, DOCX, images, URLs, and markdown with chunking
  and hybrid semantic + FTS search
- **Docker Compose deployment** — full stack (Postgres, optional Neo4j, Redis, RabbitMQ,
  backend, worker, GUI) with OpenAI-compatible embeddings endpoint support (e.g. LM Studio)

[Unreleased]: https://github.com/letuhao/free-context-hub/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/letuhao/free-context-hub/releases/tag/v0.1.0
