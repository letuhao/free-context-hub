import { applyMigrations } from './applyMigrations.js';

async function run() {
  await applyMigrations();
}

run()
  .then(() => {
    console.log('[migrate] All migrations applied');
    process.exit(0);
  })
  .catch(err => {
    console.error('[migrate] failed', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });

