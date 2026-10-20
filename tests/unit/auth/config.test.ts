// WP-0.4 — Auth.js config shape (PRD 10.1: "Auth.js — email magic link or
// credentials"). Asserts the wiring, not the runtime session: strategy,
// providers, pages, the session callback's household propagation, and the
// "sign-in cannot create accounts" adapter guard.
import { describe, expect, it, vi } from 'vitest';

// Stubbed BEFORE the dynamic import: lib/auth/db.ts builds a lazy postgres-js
// client (no connection at construction), so any syntactically valid URL works
// and nothing in the unit path ever opens a socket.
process.env.DATABASE_URL ??= 'postgres://stub:***@127.0.0.1:59999/onetable-unittest';

const { authConfig, adapter, guardAdapter, AccountCreationViaSignInError, nodemailerProvider, credentialsProvider } =
  await import('@/lib/auth/config');

describe('authConfig', () => {
  it('uses server-side database sessions', () => {
    expect(authConfig.session?.strategy).toBe('database');
  });

  it('registers exactly the two PRD sign-in methods', () => {
    const ids = (authConfig.providers ?? [])
      .flat()
      .map((p) => (p as { id?: string; provider?: string }).id ?? (p as { provider?: string }).provider);
    expect(ids).toContain('nodemailer');
    expect(ids).toContain('credentials');
    expect(ids).toHaveLength(2);
  });

  it('routes sign-in and magic-link checks to app pages', () => {
    expect(authConfig.pages?.signIn).toBe('/login');
    expect(authConfig.pages?.verifyRequest).toBe('/login/check-email');
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

  it('session callback propagates id + householdId from the adapter row', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test narrows Auth.js callback shape
    const sessionCb = (authConfig.callbacks as Record<string, ((...args: any[]) => any) | undefined>).session!;
    expect(typeof sessionCb).toBe('function');
    const session = { user: { name: null, email: null } } as never;
    const result = sessionCb({
      session,
      user: { id: 'u-1', householdId: 'h-7', email: 'a@b.co', emailVerified: null },
    });
    expect(result.user.id).toBe('u-1');
    expect(result.user.householdId).toBe('h-7');
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
