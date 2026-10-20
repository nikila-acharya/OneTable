# WP-0.4 — Auth (Auth.js) + NF-P1 encryption helper

Everything in this WP lives under `lib/`, `db/schema/auth.ts`, `types/`,
`app/api/auth/[...nextauth]/` and `tests/`. It is deliberately **drop-in**:
it imports nothing from the WP-0.1 scaffold except the `@/` alias, and it
owns no file another M0 WP owns (package.json, tsconfig.json and db/schema.ts
are merged by the integrator — see Merge notes below).

## What was built

1. **Auth.js v5 (next-auth beta)** — `lib/auth/`
   - Two sign-in methods, per PRD 10.1 / AC01: **magic link** (Nodemailer
     provider) and **credentials** (email + scrypt-hashed password).
   - **Database session strategy** (`session: { strategy: 'database' }`) —
     server-side sessions so sign-out and PV03 household deletion kill live
     sessions by deleting rows.
   - **Single User per household (AC01/PV02)**:
     - `db/schema/auth.ts`: `user` table carries `household_id` with a
       **UNIQUE index** (`user_household_id_key`) — the DB itself refuses a
       second login for a household; also `user_email_key` UNIQUE.
     - `lib/auth/users.ts`: `assertSingleUserPerHousehold` pre-check +
       `createHouseholdUser` (for onboarding/seed), `verifyCredentials`
       (anti user-enumeration: constant one-scrypt-per-attempt cost).
     - Sign-in never creates users: the adapter's `createUser` is guarded
       (`AccountCreationViaSignInError`) — a household + its User are created
       together in onboarding (WP-1.6), never via a stray magic link.
   - `requireUser()` — the 401 guard for route handlers / server actions /
     the tool layer (WP-0.5); returns `{ userId, email, householdId }`.
   - Dev magic links: with `SMTP_HOST` unset, links are printed to the server
     console (masked address); **production throws** instead — a live token
     URL can never end up in a production log (NF-P6 spirit).
   - Route handler: `app/api/auth/[...nextauth]/route.ts`.
2. **Encryption helper (NF-P1)** — `lib/crypto/encryption.ts`
   - AES-256-GCM, key from `ENCRYPTION_KEY` env (strict 32-byte canonical
     base64, generation command documented in `.env.example`), random 12-byte
     IV per call, versioned envelope `v1:base64(iv‖ct‖tag)`.
   - Optional `context` bound as AAD — recommended for WP-1.3 health rows as
     `member:<id>` so ciphertext copied to another row fails to decrypt.
   - `encryptString/decryptString/encryptJson/decryptJson`; every failure is
     `EncryptionError` with messages that never leak plaintext/keys.
   - `v1:` prefix is the key-rotation hook for a later WP.
3. **`.env.example`** — blank values only (per task). Superset template:
   includes WP-0.2's names (`DATABASE_URL`, `ENCRYPTION_KEY`, `AUTH_SECRET`,
   `AUTH_URL`, …) so the first merge is a no-op rename, not a re-litigation.

## Password storage

scrypt via `node:crypto` (memory-hard, **no native build** — Windows dev
machine stays installable). Format `scrypt$N$r$p$saltB64$hashB64`, N=2^15,
r=8, p=1, 32 MiB; parameters stored per-hash so future parameter bumps verify
old hashes (upgrade on next sign-in is a later WP). Magic-link-only users
have `password_hash NULL` — the column is nullable by design.

## Merge notes (integrator checklist)

- **package.json is a hotspot this WP does NOT commit** — the local copy is
  marked as a verification manifest. Merge these into WP-0.1's scaffold
  manifest:
  - deps: `next-auth@^5.0.0-beta.32` (+peer `nodemailer@^7.0.7`),
    `@auth/drizzle-adapter@^1.9.0`, `drizzle-orm@^0.44.6` (align with WP-0.2),
    `postgres@^3.4.5` (WP-0.2), `zod@^3.24.1`
  - dev deps: `@types/react@^19` (next types), `vitest@^2.1.8`,
    `typescript@^5.7.2`
  - The `@` → repo-root alias must exist in scaffold tsconfig
    (`"baseUrl": "."`, `"paths": { "@/*": ["./*"] }`) and in the scaffold
    vitest config (mirrors this WP's local `vitest.config.ts`).
- **db/schema.ts is WP-0.2's file**: add `export * from './schema/auth';`
  there, then point `lib/auth/db.ts` at their aggregate schema once the
  `household` table exists and add the FK:
  `householdId → references(() => household.id, { onDelete: 'cascade' })`.
  Generate ONE combined drizzle-kit migration at merge (this WP's schema uses
  the adapter-compatible camel table exports + snake columns).
- If WP-0.1 already created an app-level `.env.example`, diff against this
  one; the intent is one superset template, blank values only.
- Login screens (`/login`, `/login/check-email`) and the onboarding user
  creation call (`createHouseholdUser`) belong to WP-1.6; `requireUser()` is
  the contract they consume.

## Running the checks

```
npm install
npm run typecheck   # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm test            # vitest run — no DB, no SMTP, no network
```
