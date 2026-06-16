#!/usr/bin/env bash
# Phase 17.x — controlled-state baseline stack starter.
#
# Restarts mcp + worker + ragas-judge with .env.baseline overrides, then
# runs the preflight check. If preflight fails, exits without starting a
# baseline. If preflight passes, prints the recommended runBaseline command.
#
# Usage:
#   bash scripts/start-baseline-stack.sh
#   bash scripts/start-baseline-stack.sh --strict   # forbid extra loaded models

set -euo pipefail

cd "$(dirname "$0")/.."

STRICT_ARG=""
if [[ "${1:-}" == "--strict" ]]; then
  STRICT_ARG="--strict"
fi

echo "─────────────────────────────────────────────────────────────"
echo "Restarting stack with .env.baseline overrides..."
echo "─────────────────────────────────────────────────────────────"

# Restart MCP + worker with the rerank / distillation pins from .env.baseline.
# --env-file applied AFTER the default .env, so .env.baseline keys win.
docker compose \
  --env-file .env \
  --env-file .env.baseline \
  --profile measurement \
  up -d --force-recreate mcp worker ragas-judge

echo ""
echo "Waiting for services to come up..."
for svc in mcp:3001 ragas-judge:3005; do
  port="${svc#*:}"
  service="${svc%:*}"
  for i in $(seq 1 30); do
    if curl -sS --max-time 2 "http://localhost:${port}/health" > /dev/null 2>&1 \
       || curl -sS --max-time 2 "http://localhost:${port}/api/health" > /dev/null 2>&1 \
       || curl -sS --max-time 2 "http://localhost:${port}/" > /dev/null 2>&1; then
      echo "  ✓ ${service} (:${port})"
      break
    fi
    if [[ $i -eq 30 ]]; then
      echo "  ✗ ${service} (:${port}) did not respond after 60s"
      exit 1
    fi
    sleep 2
  done
done

echo ""
echo "─────────────────────────────────────────────────────────────"
echo "Running preflight check..."
echo "─────────────────────────────────────────────────────────────"

node scripts/preflight-baseline.mjs $STRICT_ARG

echo ""
echo "─────────────────────────────────────────────────────────────"
echo "Stack ready. Run the baseline with:"
echo "─────────────────────────────────────────────────────────────"
echo ""
echo "  ANSWERER_AGENT_MODEL=mistralai/mistral-nemo-instruct-2407 \\"
echo "  RAGAS_JUDGE_URL=http://localhost:3005 \\"
echo "  npx tsx src/qc/runBaseline.ts \\"
echo "    --tag <your-tag> \\"
echo "    --gen-eval on \\"
echo "    --top-k-contexts 3 \\"
echo "    --samples 1"
echo ""
