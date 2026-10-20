/**
 * OneTable — seed CLI (WP-0.2, NF-7).
 *   npm run db:seed            # migrate + wipe + seed the two demo households
 *   SEED_FORCE=1 npm run db:seed   # allow wiping a non-onetable database (be careful)
 */
import 'dotenv/config';
import { openDb, requireDatabaseUrl } from '../db/index.js';
import { seed } from '../db/seed.js';

async function main(): Promise<void> {
  const url = requireDatabaseUrl();
  const masked = url.replace(/\/\/[^@/]+@/, '//***@');
  console.log(`[seed] target: ${masked}`);
  const { db, sql } = openDb(url);
  try {
    await seed(db, { force: process.env.SEED_FORCE === '1' });
    console.log('[seed] OK — households: "Busy Parent Household", "Fitness Couple Household" (NF-7)');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('[seed] FAILED:', err);
  process.exitCode = 1;
});
