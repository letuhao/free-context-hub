/**
 * Runs RAG QC harness with default project_id for Phase 6 verification.
 * Override: QC_PROJECT_ID=other npm run qc:rag:phase6
 */
process.env.QC_PROJECT_ID = process.env.QC_PROJECT_ID?.trim() || 'phase6-qc-free-context-hub';
await import('../qc/ragQcRunner.js');
