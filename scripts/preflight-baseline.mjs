#!/usr/bin/env node
/**
 * Phase 17.x — preflight check before running a gen-eval baseline.
 *
 * Verifies LM Studio has exactly the models we need loaded, and that the
 * ragas-judge sidecar + MCP server are reachable. Refuses to proceed (exit 1)
 * if any expected model is missing or any service is unreachable — that
 * prevents wasting 1-2 hours on a run that would silently produce garbage
 * scores due to model swaps.
 *
 * Usage:
 *   node scripts/preflight-baseline.mjs
 *   node scripts/preflight-baseline.mjs --strict   (also forbid extra models)
 */

const LM_STUDIO = process.env.LM_STUDIO_URL || 'http://localhost:1234';
const MCP_URL = process.env.MCP_SERVER_URL || 'http://localhost:3000';
const JUDGE_URL = process.env.RAGAS_JUDGE_URL || 'http://localhost:3005';

const EXPECTED_CHAT = 'mistralai/mistral-nemo-instruct-2407';
const EXPECTED_EMBED = 'text-embedding-bge-m3';

const strict = process.argv.includes('--strict');

let exit_code = 0;
const issues = [];
const ok = [];

function check(label, pass, detail) {
  if (pass) {
    ok.push(`✓ ${label}`);
    if (detail) console.log(`✓ ${label}: ${detail}`);
    else console.log(`✓ ${label}`);
  } else {
    issues.push(`✗ ${label}: ${detail}`);
    console.error(`✗ ${label}: ${detail}`);
    exit_code = 1;
  }
}

async function fetchJson(url, timeoutMs = 5000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

console.log('╭───────────────────────────────────────────────────────────────╮');
console.log('│  Baseline preflight — Phase 17.x controlled-state check       │');
console.log('╰───────────────────────────────────────────────────────────────╯');
console.log('');

// ─── LM Studio reachable + loaded models ───
let loadedModels = [];
try {
  const d = await fetchJson(`${LM_STUDIO}/api/v0/models`);
  loadedModels = (d.data || [])
    .filter((m) => m.state === 'loaded')
    .map((m) => ({ id: m.id, type: m.type }));
  check('LM Studio reachable', true, `${loadedModels.length} model(s) loaded`);
} catch (err) {
  check('LM Studio reachable', false, `${LM_STUDIO} → ${err.message}`);
}

const chatLoaded = loadedModels.find((m) => m.id === EXPECTED_CHAT);
const embedLoaded = loadedModels.find((m) => m.id === EXPECTED_EMBED);

check(
  `Chat model loaded: ${EXPECTED_CHAT}`,
  !!chatLoaded,
  chatLoaded
    ? `type=${chatLoaded.type}`
    : `not loaded; loaded chat models: [${loadedModels.filter((m) => m.type === 'llm' || m.type === 'vlm').map((m) => m.id).join(', ') || 'none'}]`,
);
check(
  `Embeddings loaded: ${EXPECTED_EMBED}`,
  !!embedLoaded,
  embedLoaded
    ? `type=${embedLoaded.type}`
    : `not loaded; loaded embeddings: [${loadedModels.filter((m) => m.type === 'embeddings').map((m) => m.id).join(', ') || 'none'}]`,
);

// Strict mode: refuse if extra chat models are loaded (they'd cause swap on
// any request that mistakenly hits them).
if (strict) {
  const extras = loadedModels.filter(
    (m) =>
      (m.type === 'llm' || m.type === 'vlm') && m.id !== EXPECTED_CHAT,
  );
  check(
    `No extra chat models (--strict)`,
    extras.length === 0,
    extras.length === 0
      ? 'clean'
      : `found ${extras.length}: [${extras.map((m) => m.id).join(', ')}] — unload to prevent swap`,
  );
}

// ─── MCP server reachable ───
try {
  await fetchJson(`${MCP_URL.replace(/\/$/, '').replace(/\/mcp$/, '')}/api/health`, 3000)
    .catch(async () => {
      // Fallback: try / for MCP server
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3000);
      try {
        await fetch(MCP_URL, { signal: ctl.signal });
      } finally {
        clearTimeout(t);
      }
    });
  check('MCP server reachable', true, MCP_URL);
} catch (err) {
  check('MCP server reachable', false, `${MCP_URL} → ${err.message}`);
}

// ─── ragas-judge sidecar reachable + judge model matches ───
try {
  const d = await fetchJson(`${JUDGE_URL}/health`, 5000);
  check(
    'ragas-judge sidecar healthy',
    d.status === 'ok',
    `judge=${d.judge_model}, embeddings=${d.embeddings_model}`,
  );
  check(
    `Sidecar judge_model matches chat (${EXPECTED_CHAT})`,
    d.judge_model === EXPECTED_CHAT,
    d.judge_model === EXPECTED_CHAT
      ? 'pinned'
      : `sidecar configured for "${d.judge_model}", baseline expects "${EXPECTED_CHAT}" — sidecar will trigger model swap`,
  );
  check(
    `Sidecar embeddings_model matches (${EXPECTED_EMBED})`,
    d.embeddings_model === EXPECTED_EMBED,
    d.embeddings_model === EXPECTED_EMBED
      ? 'pinned'
      : `sidecar configured for "${d.embeddings_model}", baseline expects "${EXPECTED_EMBED}"`,
  );
} catch (err) {
  check('ragas-judge sidecar reachable', false, `${JUDGE_URL} → ${err.message}`);
}

// ─── Container env audit (2026-06-17 baseline-stack bug fix) ───
// CRITICAL: --env-file .env.baseline only affects compose-substitution; the
// container env comes from `env_file: - .env` UNLESS docker-compose has an
// explicit `environment:` line with substitution. Even when substitution is
// in place, colon-hyphen `${X:-default}` reverts to default for empty values.
// Both bugs were present until 2026-06-17 and silently contaminated every
// baseline by leaving the WORKER running gemma-flavored faq.build /
// knowledge.loop / raptor.build jobs that swap LM Studio mid-measurement.
// Audit the running containers directly to catch any future regression.
async function dockerEnv(container, varName) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('docker', [
    'exec', container, 'sh', '-c', `printenv ${varName} || true`,
  ], { encoding: 'utf8' });
  return (r.stdout || '').trim();
}
for (const svc of ['free-context-hub-mcp-1', 'free-context-hub-worker-1']) {
  const distModel = await dockerEnv(svc, 'DISTILLATION_MODEL');
  const distEnabled = await dockerEnv(svc, 'DISTILLATION_ENABLED');
  const qaModel = await dockerEnv(svc, 'QA_AGENT_MODEL');
  const builderModel = await dockerEnv(svc, 'BUILDER_AGENT_MODEL');
  // The intent of .env.baseline: every chain that falls through to
  // DISTILLATION_MODEL must end with either an empty value or the
  // EXPECTED_CHAT model. ANY OTHER value would swap LM Studio mid-run.
  const safe = (v) => v === '' || v === EXPECTED_CHAT;
  const allSafe = safe(distModel) && safe(qaModel) && safe(builderModel)
    && distEnabled !== 'true';
  check(
    `${svc} model env safe for baseline`,
    allSafe,
    allSafe
      ? `DISTILLATION_MODEL='${distModel}', DISTILLATION_ENABLED='${distEnabled}', QA_AGENT_MODEL='${qaModel}', BUILDER_AGENT_MODEL='${builderModel}'`
      : `DISTILLATION_MODEL='${distModel}', DISTILLATION_ENABLED='${distEnabled}', QA_AGENT_MODEL='${qaModel}', BUILDER_AGENT_MODEL='${builderModel}' — any non-empty + non-'${EXPECTED_CHAT}' value here triggers a mid-baseline swap. Verify start-baseline-stack.sh used .env.baseline AND docker-compose.yml uses single-hyphen substitution`,
  );
}

// ─── Reminder about other env consumers ───
console.log('');
console.log('Process-environment hints (set these on the runBaseline.ts invocation):');
console.log(`  ANSWERER_AGENT_MODEL=${EXPECTED_CHAT}`);
console.log(`  RAGAS_JUDGE_URL=${JUDGE_URL}`);
console.log('');

// ─── Summary ───
console.log('───────────────────────────────────────────────────────────────');
if (exit_code === 0) {
  console.log(`PREFLIGHT OK — ${ok.length} checks passed, baseline may proceed`);
} else {
  console.error(`PREFLIGHT FAILED — ${issues.length} issue(s); refusing to start baseline`);
  console.error('');
  console.error('Fix steps:');
  console.error('  1. Load expected models in LM Studio (Developer page → Load model):');
  console.error(`       ${EXPECTED_CHAT}`);
  console.error(`       ${EXPECTED_EMBED}`);
  console.error('  2. Restart MCP + ragas-judge with .env.baseline:');
  console.error('       docker compose --env-file .env --env-file .env.baseline \\');
  console.error('         --profile measurement up -d --force-recreate mcp worker ragas-judge');
  console.error('  3. Re-run preflight: node scripts/preflight-baseline.mjs --strict');
}
process.exit(exit_code);
