/**
 * Env vars for QC verify scripts (`verifyPhase6Qc`, `verifyPhase6`, audit).
 * Prefer `QC_VERIFY_*`; deprecated aliases `VERIFY_PHASE6_*` still work.
 */
function firstString(...vals: Array<string | undefined>): string | undefined {
  for (const v of vals) {
    const t = v?.trim();
    if (t) return t;
  }
  return undefined;
}

export function qcVerifyRepoRoot(): string {
  return firstString(process.env.QC_VERIFY_REPO_ROOT, process.env.VERIFY_PHASE6_ROOT) ?? '/workspace';
}

export function qcVerifyProjectId(defaultId: string): string {
  return (
    firstString(
      process.env.QC_VERIFY_PROJECT_ID,
      process.env.VERIFY_PHASE6_QC_PROJECT_ID,
      process.env.VERIFY_PHASE6_PROJECT_ID,
    ) ?? defaultId
  );
}

export function qcVerifyCorrelationId(): string | undefined {
  return firstString(process.env.QC_VERIFY_CORRELATION_ID, process.env.VERIFY_PHASE6_CORRELATION_ID);
}

export function qcVerifyDeepMaxRounds(fallback: number): number {
  const raw = firstString(
    process.env.QC_VERIFY_DEEP_MAX_ROUNDS,
    process.env.VERIFY_PHASE6_DEEP_MAX_ROUNDS,
  );
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(1, n) : fallback;
}

export function qcVerifySkipBuilderMemory(): boolean {
  const a = process.env.QC_VERIFY_SKIP_BUILDER_MEMORY ?? process.env.VERIFY_PHASE6_SKIP_BUILDER_MEMORY;
  return String(a ?? '').toLowerCase() === 'true';
}

/** Job audit script: `QC_AUDIT_CORRELATION_ID` or deprecated `PHASE6_AUDIT_CORRELATION_ID`. */
export function qcAuditCorrelationId(): string | undefined {
  return firstString(
    process.env.QC_AUDIT_CORRELATION_ID,
    process.env.PHASE6_AUDIT_CORRELATION_ID,
    process.env.QC_VERIFY_CORRELATION_ID,
    process.env.VERIFY_PHASE6_CORRELATION_ID,
  );
}
