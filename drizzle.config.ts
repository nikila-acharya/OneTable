import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run drizzle-kit (see .env.example)');
}

// Neon compatibility: URLs with sslmode=require / ssl=true are honored by the
// postgres.js driver. `drizzle-kit generate` needs no DB at all; `db:push` and
// `studio` are not used in CI — committed SQL migrations only (PRD rule-source
// culture: every schema change is a reviewable file in drizzle/migrations/).
export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.ts',
  out: './drizzle/migrations',
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
