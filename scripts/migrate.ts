/**
 * OneTable — apply committed SQL migrations (WP-0.2).
 * Runs drizzle/migrations/ via the drizzle migrator against DATABASE_URL.
 * This is the ONLY supported way to change schema state — no `db:push`.
 *   npm run db:migrate
 */
import 'dotenv/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { openDb, requireDatabaseUrl } from '../db/index.js';

const MIGRATIONS_FOLDER = 'drizzle/migrations';

async function main(): Promise<void> {
  const url = requireDatabaseUrl();
  const masked = url.replace(/\/\/[^@/]+@/, '//***@');
  console.log(`[migrate] target: ${masked}`);
  const { db, sql } = openDb(url);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log(`[migrate] OK — applied all migrations from ${MIGRATIONS_FOLDER}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err);
  process.exitCode = 1;
});
