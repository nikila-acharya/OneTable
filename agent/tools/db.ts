// WP-0.5 — Minimal database port. The app supplies a postgres.js-backed adapter
// (WP-0.2 wiring); tests use a recording fake. Agents never touch this directly —
// only tool handlers do (PRD 10.2 "No agent touches the database directly").

export type SqlValue = string | number | boolean | null | Date;

export interface Db {
  /** Run a parameterized query ($1, $2, ... placeholders) and return the rows. */
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly SqlValue[],
  ): Promise<T[]>;
}
