// Session shape augmentation (WP-0.4). Auth.js v5 module paths:
// 'next-auth' for the client-visible Session, '@auth/core/adapters' not
// needed since we read householdId via a cast in the callback.
import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      /** user.id (uuid) */
      id: string;
      /** the single household this User owns (AC01) — '' only transiently */
      householdId: string;
    } & import('next-auth').DefaultSession['user'];
  }
}

// Under the JWT strategy the session callback receives a token, not the
// adapter row, so id + householdId have to be carried on the JWT itself.
// Declared here rather than cast at the call site so a missing field is a
// compile error instead of a silent '' at runtime.
//
// Both module paths are augmented because they are distinct declarations to
// TypeScript: the callback parameter types resolve through @auth/core, while
// 'next-auth/jwt' is what application code imports. Augmenting only the latter
// left token.uid typed as '{}' and the assignments in config.ts failed to
// compile.
declare module 'next-auth/jwt' {
  interface JWT {
    /** user.id (uuid); set once at sign-in by the jwt callback */
    uid?: string;
    /** the single household this User owns (AC01) */
    householdId?: string;
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    uid?: string;
    householdId?: string;
  }
}
