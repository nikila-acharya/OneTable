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

export const authConfig: NextAuthConfig = {
  adapter,
  session: {
    // Server-side sessions: sign-out is instant, and PV03 household deletion
    // can kill live sessions by deleting rows.
    strategy: 'database',
  },
  pages: {
    signIn: '/login',
    verifyRequest: '/login/check-email',
    error: '/login',
  },
  providers: [nodemailerProvider, credentialsProvider],
  callbacks: {
    session({ session, user }) {
      // `user` is the adapter row (every column, including our householdId).
      const au = user as AdapterUser & { householdId?: string };
      if (session.user) {
        session.user.id = user.id;
        session.user.householdId = au.householdId ?? '';
      }
      return session;
    },
  },
};
