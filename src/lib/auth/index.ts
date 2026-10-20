// lib/auth/index.ts — the Auth.js entry point (import '@/lib/auth').
// Owned by WP-0.4. Next.js App Router wiring: app/api/auth/[...nextauth]/route.ts
// exports the handlers; server code uses auth()/requireUser().
import NextAuth from 'next-auth';
import { authConfig } from './config';

export { AccountCreationViaSignInError, authConfig } from './config';

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export class AuthenticationError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export interface AuthContext {
  userId: string;
  email: string;
  householdId: string;
}

/**
 * Server-side guard for route handlers / server actions / tool layer:
 * returns the signed-in User or throws AuthenticationError (401).
 * Tier checks (AC01) live in WP-1.5 — read them from the household, never
 * trust the session for tier.
 */
export async function requireUser(): Promise<AuthContext> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new AuthenticationError('not signed in');
  if (!user.householdId) {
    // Session row predates the household column (or a broken insert): force a
    // fresh sign-in rather than half-trusting it.
    throw new AuthenticationError('session is missing household membership — sign in again');
  }
  return {
    userId: user.id,
    email: user.email ?? '',
    householdId: user.householdId,
  };
}
