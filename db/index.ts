/**
 * OneTable — Drizzle client factory (WP-0.2).
 * postgres-js driver; Neon-compatible URL handling (sslmode=require → ssl).
 * The Next.js app (WP-0.1+) may build its own pool; this is the shared,
 * dependency-light way to open the DB from scripts and tests.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema } from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

/** Neon connection strings use `sslmode=require` (libpq style), which
 *  postgres.js does not parse; it wants `ssl=true` / `ssl=no-verify`. */
export function normalizeDatabaseUrl(url: string): string {
  return url
    .replace(/([?&])sslmode=(?:require|verify-ca|verify-full|prefer)/gi, '$1ssl=true')
    .replace(/&sslmode=(?:disable|allow)/gi, '')
    .replace(/\?sslmode=(?:disable|allow)(?=&|$)/gi, '?')
    .replace(/\?$/, '');
}

export function requireDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example: Neon dev DB or docker compose Postgres)');
  return url;
}

/**
 * Open the DB. max=1 is right for migrate/seed/tests; the app will want a pool.
 * `idle` and `maxLifetime` kept conservative for Neon serverless connections.
 */
export function openDb(databaseUrl: string = requireDatabaseUrl()): {
  db: Db;
  sql: postgres.Sql;
} {
  const sql = postgres(normalizeDatabaseUrl(databaseUrl), {
    max: 1,
    idle_timeout: 10,
    connect_timeout: 30,
  });
  return { db: drizzle(sql, { schema }), sql };
}
