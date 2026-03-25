import { applyMigrations } from './applyMigrations.js';

async function run() {
  await applyMigrations();
}

run()
  .then(() => {
    console.log('[migrate] All migrations applied');
    process.exit(0);
  })
  .catch(() => process.exit(1));

