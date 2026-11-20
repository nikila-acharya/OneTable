// WP-0.4 — Auth.js config shape (PRD 10.1: "Auth.js — email magic link or
// credentials"). Asserts the wiring, not the runtime session: strategy,
// providers, pages, the session callback's household propagation, and the
// "sign-in cannot create accounts" adapter guard.
import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Stubbed BEFORE the dynamic import: lib/auth/db.ts builds a lazy postgres-js
// client (no connection at construction), so any syntactically valid URL works
// and nothing in the unit path ever opens a socket.
process.env.DATABASE_URL ??= 'postgres://stub:***@127.0.0.1:59999/onetable-unittest';

const { authConfig, adapter, guardAdapter, AccountCreationViaSignInError, nodemailerProvider, credentialsProvider } =
  await import('@/lib/auth/config');

describe('authConfig', () => {
  it('uses JWT sessions, because the Credentials provider cannot use database sessions', () => {
    // Regression guard. This repo shipped strategy:'database' alongside a
    // Credentials provider, and the suite asserted that combination by name, so
    // a green test was actively protecting a config in which sign-in set a
    // cookie that resolved to nothing (every authenticated route 401'd).
    const ids = (authConfig.providers ?? [])
      .flat()
      .map((p) => (p as { id?: string }).id);
    expect(ids).toContain('credentials');
    expect(authConfig.session?.strategy).toBe('jwt');
    // The failure mode we are guarding against is specifically
    // credentials + database, so pin both halves of that assertion.
    expect(authConfig.session?.strategy).not.toBe('database');
  });

  it('bounds the session so the lost database-session revocation stays short', () => {
    // PV03 used to revoke by deleting session rows. A JWT cannot be revoked, so
    // the expiry is the revocation window and must stay finite and small.
    expect(typeof authConfig.session?.maxAge).toBe('number');
    expect(authConfig.session!.maxAge!).toBeGreaterThan(0);
    expect(authConfig.session!.maxAge!).toBeLessThanOrEqual(900);
    expect(authConfig.session!.updateAge!).toBeLessThanOrEqual(authConfig.session!.maxAge!);
  });

  it('registers exactly the two PRD sign-in methods', () => {
    const ids = (authConfig.providers ?? [])
      .flat()
      .map((p) => (p as { id?: string; provider?: string }).id ?? (p as { provider?: string }).provider);
    expect(ids).toContain('nodemailer');
    expect(ids).toContain('credentials');
    expect(ids).toHaveLength(2);
  });

  it('only points Auth.js at pages that exist as routes', () => {
    // Regression guard: pages.signIn was '/login' and pages.verifyRequest was
    // '/login/check-email' while neither route existed, so every Auth.js
    // redirect to sign-in landed on a 404 and an expired/absent session was
    // unrecoverable. Asserting the config against the filesystem means a
    // documented-but-missing page can never pass again.
    const appRoot = join(process.cwd(), 'src', 'app');
    const entries = Object.entries(authConfig.pages ?? {});
    expect(entries.length).toBeGreaterThan(0);
    for (const [name, path] of entries) {
      const seg = String(path).replace(/^\//, '').split('/');
      const dir = join(appRoot, ...seg);
      const hasPage = ['page.tsx', 'page.ts', 'page.jsx', 'route.ts'].some((f) =>
        existsSync(join(dir, f)),
      );
      expect(hasPage, `pages.${name} -> ${path} has no route file under src/app`).toBe(true);
    }
  });

  it('has an adapter whose createUser is refused (households are created via onboarding, not login)', async () => {
    expect(adapter).toBeTruthy();
    await expect(adapter!.createUser!({ email: 'stranger@nowhere.test' } as never)).rejects.toThrow(
      AccountCreationViaSignInError,
    );
  });

  it('guardAdapter passes every other adapter method through untouched', () => {
    const fake = {
      getUserByEmail: async () => null,
      createUser: async () => ({ id: 'x' }),
    };
    const guarded = guardAdapter(fake as never);
    expect(guarded.getUserByEmail).toBe(fake.getUserByEmail);
  });

  it('carries id + householdId through the jwt -> session chain', () => {
    // The whole point of the JWT rewrite. `user` exists ONLY on the sign-in
    // request, so requireUser() would have received an empty householdId on
    // every later request (401 "session is missing household membership") if
    // the fields were not copied onto the token at sign-in and read back from
    // it afterwards. Assert the two-callback chain, not one callback.
    type JwtCb = (args: Record<string, unknown>) => Record<string, unknown>;
    type SessionCb = (args: Record<string, unknown>) => { user: { id: string; householdId: string } };
    const cbs = authConfig.callbacks as unknown as Record<string, unknown>;
    const jwtCb = cbs.jwt as JwtCb;
    const sessionCb = cbs.session as SessionCb;
    expect(typeof jwtCb).toBe('function');
    expect(typeof sessionCb).toBe('function');

    // 1) sign-in request: user present, token starts bare
    const token = jwtCb({ token: {}, user: { id: 'u-1', householdId: 'h-7', email: 'a@b.co' } });
    expect(token.uid).toBe('u-1');
    expect(token.householdId).toBe('h-7');

    // 2) a LATER request: Auth.js passes no user at all — only the token
    const later = sessionCb({ session: { user: { name: null, email: null } }, token });
    expect(later.user.id).toBe('u-1');
    expect(later.user.householdId).toBe('h-7');
  });

  it('yields an empty householdId when the token has none, which requireUser rejects', () => {
    // Deliberate contract with lib/auth/index.ts requireUser(): a token without
    // household membership must surface as '' (=> 401 "sign in again") rather
    // than as undefined slipping past the guard.
    const cbs = authConfig.callbacks as unknown as Record<string, unknown>;
    const sessionCb = cbs.session as (a: Record<string, unknown>) => { user: { id: string; householdId: string } };
    const session = sessionCb({ session: { user: { name: null, email: null } }, token: { uid: 'u-9' } });
    expect(session.user.id).toBe('u-9');
    expect(session.user.householdId).toBe('');
  });

  it('dev magic-link sender refuses to log links in production', async () => {
    const opts = nodemailerProvider as unknown as {
      options: { sendVerificationRequest?: (p: { identifier: string; url: string }) => Promise<void> };
      id: string;
    };
    // If SMTP_HOST is unset in this process, the dev printer exists and must
    // throw in production. When a real host is configured the override is
    // absent and nodemailer sends — only the provider identity is asserted.
    if (opts.options && typeof opts.options.sendVerificationRequest === 'function') {
      vi.stubEnv('NODE_ENV', 'production');
      try {
        await expect(
          opts.options.sendVerificationRequest({ identifier: 'a@b.co', url: 'https://x/verify?token=***' }),
        ).rejects.toThrow(/SMTP_HOST is required in production/);
      } finally {
        vi.unstubAllEnvs();
      }
    } else {
      expect(opts.id).toBe('nodemailer');
    }
  });

  it('credentials provider exposes email + password fields and an authorize fn', () => {
    // Shape verified against @auth/core beta Credentials(): the factory keeps
    // the user config under `options` (top-level `credentials` is only
    // populated by Auth.js init), so assert where the config actually lives.
    const prov = credentialsProvider as unknown as {
      id: string;
      options: { credentials?: Record<string, unknown>; authorize?: unknown };
    };
    expect(prov.id).toBe('credentials');
    expect(Object.keys(prov.options.credentials ?? {})).toEqual(['email', 'password']);
    expect(typeof prov.options.authorize).toBe('function');
  });
});
