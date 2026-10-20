// lib/auth/db.ts — lazy Postgres client for the auth layer.
// Owned by WP-0.4. WP-0.2 owns the canonical db client (drizzle-orm +
// postgres.js, per its drizzle.config.ts); at merge, replace this file's
// internals with their exported client + aggregate schema and keep this
// module path as the auth layer's import point.
//
// Lazy: importing this module must NOT open a connection or require
// DATABASE_URL — unit tests import the auth config for shape checks, and the
// connection should only happen on the first real query (Next.js dev HMR
// re-imports too).
import { drizzle, PostgresJsDatabase, type PostgresJsDatabase as PostgresJsDb } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as authSchema from '../../../db/schema';

export const authSchemaTables = authSchema;
export type AuthDatabase = PostgresJsDb<typeof authSchema>;

let client: AuthDatabase | null = null;
let sqlInstance: ReturnType<typeof postgres> | null = null;

export function getDb(): AuthDatabase {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set — copy the env template to .env (or run `docker compose up -d` for the local Postgres, WP-0.2)');
    }
    // prepare:false → works through Neon/connection-pooler pgbouncer;
    // small pool because this is a single-user household app, not a fanout API.
    sqlInstance = postgres(url, { max: 5, prepare: false });
    client = drizzle(sqlInstance, { schema: authSchema });
  }
  return client;
}

/**
 * Proxy so `DrizzleAdapter(db)` can be constructed at module load without a
 * live database: every property access resolves lazily via getDb().
 *
 * The proxy TARGET is an object with the real client's prototype because
 * @auth/drizzle-adapter sniffs the dialect with `is(db, PgDatabase)`
 * (instanceof through the prototype chain). A bare `{}` proxy would be
 * rejected with "Unsupported database type (object)"; this keeps laziness
 * (still no DATABASE_URL needed until the first query) while satisfying the
 * brand check.
 */
export const db = new Proxy(Object.create(PostgresJsDatabase.prototype) as object, {
  get(_target, prop, _receiver) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(real, prop);
    return typeof value === 'function' ? (value as CallableFunction).bind(real) : value;
  },
}) as AuthDatabase;

/** Close the pool (used by integration scripts/tests; safe when never opened). */
export async function closeDb(): Promise<void> {
  if (sqlInstance) {
    await sqlInstance.end({ timeout: 2 });
    sqlInstance = null;
    client = null;
  }
}
