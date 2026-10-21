# ADR 009 - Sign-up before onboarding (WP-1.6, slice 2)

Date: 2026-10-21 - Status: accepted (owner chose sign-up first, 2026-10-21)
Relates to: ADR-002 (single User per household), ADR-008 (onboarding write path), lib/auth

## Decisions
1. **Sign-up creates the household and its one User together** (POST /api/signup). It is the only account-creation path; sign-in still never creates accounts (adapter guard). Users get a free household and the email+password credentials login.
2. **Password rule:** at least 10 characters. scrypt hashing (lib/auth/password). Stored as a hash only; the test checks the plain text is absent.
3. **Duplicate email:** 409 email_taken. This reveals whether an email has an account. Accepted for MVP so the user can be told to sign in instead; the sign-in path already uses constant-time checks. Revisit with the owner if enumeration is a concern.
4. **Orphan cleanup:** if the user insert fails after the household insert, the household is deleted in the same request.
5. **Submit route** (POST /api/onboarding/complete) requires a session. A body that is not a draft is 400, a refused draft is 422 with issues and nothing written, a missing session is 401.
6. **Sign-in step is client-side:** after sign-up, the client signs in through the credentials provider, then submits the draft. No magic link is needed for the first run.

## Not done here
- The onboarding UI does not call these routes yet; localStorage remains the draft store until that wiring lands.
- No email verification at sign-up (emailVerified is set to the time of sign-up; a verification mail is a later WP).
- Rate limiting on sign-up and sign-in (needed before beta; flagged for WP-7.x).
