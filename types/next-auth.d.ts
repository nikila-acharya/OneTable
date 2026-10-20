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
