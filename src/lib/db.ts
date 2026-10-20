/**
 * App-side lazy DB handle for the Next.js bundle. It does NOT import
 * db/index.ts, which uses ESM-style "./schema.js" imports that the Next bundler
 * cannot resolve. Importing this module opens no connection; the first query does.
 */
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { schema } from "../../db/schema";

/** Same type as db/index.ts Db (both parameterised by the schema aggregate). */
export type Db = PostgresJsDatabase<typeof schema>;

/** Neon uses sslmode=require (libpq style); postgres.js wants ssl=true. */
function normalizeUrl(url: string): string {
  return url
    .replace(/([?&])sslmode=(?:require|verify-ca|verify-full|prefer)/gi, "$1ssl=true")
    .replace(/&sslmode=(?:disable|allow)/gi, "")
    .replace(/\?sslmode=(?:disable|allow)(?=&|$)/gi, "?")
    .replace(/\?$/, "");
}

let cached: Db | null = null;

export function getDb(): Db {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
    cached = drizzle(postgres(normalizeUrl(url), { max: 5, prepare: false }), { schema });
  }
  return cached;
}
