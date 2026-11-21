/**
 * Shared API error handling.
 *
 * Every route used to end with `return NextResponse.json({ error: "server_error"
 * }, { status: 500 })` and no logging at all, so a production failure left the
 * client a bare 500 and the operators nothing — the onboarding bug had to be
 * reproduced by hand, in a script, to learn what actually broke. This centralises
 * both halves: one log line per failure, one stable response shape.
 *
 * The log line is deliberately *not* a raw error dump. Drizzle wraps failing
 * statements as "Failed query: <sql>\nparams: <bound values>", so message text
 * can carry household ids and, on the health tables, clinical values. NF-P6 says
 * health data is referenced, never logged, so identifiers and the parameter list
 * are stripped before anything is written.
 */
import { NextResponse } from "next/server";

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const CLIENT_ID_RE = /\b(?:m|hh|u)_[0-9a-z_]{6,}\b/gi;

/**
 * Make an error message safe to log: drop the bound-parameter list entirely,
 * mask UUIDs and client-generated ids, and cap the length.
 * Exported for tests; callers should use serverError().
 */
export function describeError(e: unknown): string {
  const name = e instanceof Error ? e.name : typeof e;
  const raw = e instanceof Error ? e.message : String(e);
  const hadParams = /\bparams:/.test(raw);
  // Keep only the leading clause: drizzle and Postgres both put the bound
  // values and detail rows on the lines that follow, so cutting here removes
  // them rather than trying to scrub them afterwards.
  let message = (raw.split("\n")[0] ?? "").trim();
  message = message.replace(UUID_RE, "[id]").replace(CLIENT_ID_RE, "[id]");
  // Say so, or a one-line log reads as if the query had no parameters at all.
  if (hadParams) message += " [params redacted]";
  return `${name}: ${message.slice(0, 300)}`;
}

/**
 * Log a route failure and return the standard 500 body.
 * `route` is a stable identifier (e.g. "api/onboarding/complete"), never a URL,
 * so request data cannot leak into logs through it either.
 */
export function serverError(route: string, e: unknown): NextResponse {
  console.error(`[api ${route}] ${describeError(e)}`);
  return NextResponse.json({ error: "server_error" }, { status: 500 });
}
