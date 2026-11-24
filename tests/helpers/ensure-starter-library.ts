/**
 * Shared test precondition: guarantee the ADR-123 starter library exists.
 *
 * Why this is needed at all: tests/db.test.ts calls seed(), which runs
 *   truncate table household, recipe, food_item, tip, clinician_target restart identity cascade
 * — it wipes the whole recipe table and recreates only its own demo rows. Vitest
 * suites in this repo share one database (see the fileLock comment in
 * vitest.config.ts), so depending on table contents another suite can delete makes
 * a test pass or fail purely by file ordering.
 *
 * Rather than assert weaker expectations wherever the ordering lands, a suite that
 * depends on the shared library applies the same SQL migration 0008 that CI and
 * production apply. It is ON CONFLICT DO NOTHING, so it is a no-op when the
 * migration has already run, and it fails loudly if the file is missing.
 */
import fs from "node:fs";
import path from "node:path";
type UnsafeCapable = { unsafe: (sql: string) => Promise<unknown> };

/** resolved from cwd because vitest runs at the repo root, and under vitest's
 *  module loader import.meta.url is not always a file: URL. */
export const STARTER_LIBRARY_MIGRATION = path.resolve("drizzle/migrations/0008_starter_library.sql");

export async function ensureStarterLibrary(sql: UnsafeCapable): Promise<void> {
  const text = fs.readFileSync(STARTER_LIBRARY_MIGRATION, "utf8");
  if (!text.includes("0008_starter_library")) {
    throw new Error(`starter library migration looks unexpected: ${STARTER_LIBRARY_MIGRATION}`);
  }
  await sql.unsafe(text);
}
