// lib/auth/config.ts — the Auth.js v5 configuration object (providers,
// adapter, session strategy). Split from index.ts so unit tests can assert
// config shape WITHOUT instantiating NextAuth (which wants a live adapter).
// Owned by WP-0.4. Stack row PRD 10.1: "Auth | Auth.js (email magic link or
// credentials)".
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import type { Adapter, AdapterUser } from 'next-auth/adapters';
import Credentials from 'next-auth/providers/credentials';
import Nodemailer from 'next-auth/providers/nodemailer';
import type { NextAuthConfig } from 'next-auth';
import { accounts, sessions, appUser as users, verificationTokens } from '../../../db/schema';
import { db } from './db';
import { maskEmail } from './email';
import { verifyCredentials } from './users';

// Accounts are created by onboarding (household + first User together), so a
// magic link for an unknown address must NOT silently create one. We wrap the
// adapter: every Auth.js method passes through, createUser is refused.
export class AccountCreationViaSignInError extends Error {
  constructor() {
    super('sign-in cannot create accounts — a household and its User are created together during onboarding');
    this.name = 'AccountCreationViaSignInError';
  }
}

export function guardAdapter(base: Adapter): Adapter {
  return {
    ...base,
    createUser: async () => {
      throw new AccountCreationViaSignInError();
    },
  };
}

export const adapter = guardAdapter(
  DrizzleAdapter(db, {
    // Option names verified against the installed @auth/drizzle-adapter
    // (DefaultPostgresSchema: usersTable / accountsTable / sessionsTable /
    // verificationTokensTable). Our schema keeps snake_case columns and the
    // Auth.js-standard table names.
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }) as unknown as Adapter,
);

const smtpHost = process.env.SMTP_HOST?.trim() ?? '';
const smtpPort = Number(process.env.SMTP_PORT?.trim() || 587);

export const nodemailerProvider = Nodemailer({
  server: {
    host: smtpHost,
    port: Number.isInteger(smtpPort) ? smtpPort : 587,
    secure: Number.isInteger(smtpPort) && smtpPort === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
      : undefined,
  },
  from: process.env.EMAIL_FROM?.trim() || 'OneTable <no-reply@onetable.invalid>',
  // Local dev without SMTP: print the magic link to the console instead of
  // failing. Guarded so production can never degrade to logged links
  // (the URL carries a live token).
  sendVerificationRequest: smtpHost
    ? undefined
    : async ({ identifier, url }) => {
        if (process.env.NODE_ENV === 'production') {
          throw new Error('SMTP_HOST is required in production — magic links must be emailed, not logged');
        }
        // NF-P6 hygiene: masked address; the URL (token) only ever goes to the
        // developer console in dev.
        console.log(`[auth:dev] magic link for ${maskEmail(identifier)} → ${url}`);
      },
});

export const credentialsProvider = Credentials({
  id: 'credentials',
  name: 'Email and password',
  credentials: {
    email: { label: 'Email', type: 'email' },
    password: { label: 'Password', type: 'password' },
  },
  authorize: async (credentials) => {
    const user = await verifyCredentials({
      email: credentials?.email,
      password: credentials?.password,
    });
    if (!user) return null;
    // Extra fields survive to callbacks.session for database sessions.
    // (return the variable, not a fresh literal: User carries an index
    // signature but excess-property checks would still nag on literals)
    return user;
  },
});

// Session lifetime. Auth.js JWT semantics: `maxAge` is the idle window (the
// token is re-issued with a fresh expiry whenever it is refreshed), and
// `updateAge` is how often that re-issue happens. So an actively used session
// survives indefinitely while an abandoned token stops working after maxAge.
//
// 15 minutes was chosen to bound the PV03 revocation gap: with database
// sessions, deleting a household's session rows signed people out at once; a
// JWT cannot be revoked, so the worst case is now maxAge. Tightening or
// loosening it is an env change, not a deploy.
const sessionMaxAge = Number(process.env.AUTH_SESSION_MAX_AGE_SECONDS?.trim() || 900);
const sessionUpdateAge = Number(process.env.AUTH_SESSION_UPDATE_AGE_SECONDS?.trim() || 300);

export const authConfig: NextAuthConfig = {
  adapter,
  session: {
    // The Credentials provider has no database-session path: Auth.js cannot
    // write a session row for it, so sign-in returned HTTP 200 and set a
    // session cookie that resolved to nothing — `/api/auth/session` answered
    // null and every authenticated route 401'd, which dead-ended onboarding at
    // step 6 (POST /api/onboarding/complete -> 401). Reproduced against both
    // production and a clean local dev server, so it is this config, not the
    // environment. The adapter stays for the nodemailer provider's
    // verification tokens and user lookup.
    strategy: 'jwt',
    maxAge: Number.isInteger(sessionMaxAge) && sessionMaxAge > 0 ? sessionMaxAge : 900,
    updateAge: Number.isInteger(sessionUpdateAge) && sessionUpdateAge > 0 ? sessionUpdateAge : 300,
  },
  pages: {
    // '/login' and '/login/check-email' never existed (both 404), so any
    // Auth.js redirect to sign-in landed on a dead page. /onboarding step 1 is
    // the real sign-in surface: it collects email + password and, when the
    // address is already taken (409), completes a credentials sign-in. A
    // dedicated sign-in page is still worth building; until then a working
    // route beats a documented-but-missing one.
    signIn: '/onboarding',
    verifyRequest: '/onboarding',
    error: '/onboarding',
  },
  providers: [nodemailerProvider, credentialsProvider],
  callbacks: {
    jwt({ token, user }) {
      // `user` is present ONLY on the sign-in request. Under the previous
      // database strategy the session callback saw the adapter row every time;
      // copying these onto the token here is what keeps requireUser() working
      // on every later request instead of just the first one.
      if (user) {
        const au = user as AdapterUser & { householdId?: string };
        token.uid = user.id;
        token.householdId = au.householdId ?? '';
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid ?? '';
        // '' is the signal requireUser() uses to force a fresh sign-in, matching
        // the database-session behaviour it already documents.
        session.user.householdId = token.householdId ?? '';
      }
      return session;
    },
  },
};
