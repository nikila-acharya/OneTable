/**
 * Process-wide pg-boss client for CP01 background imports.
 * null when DATABASE_URL is absent (unit contexts); failures reset so a
 * later request can retry. No worker runs in dev/CI — jobs queue and wait;
 * the VPS deployment (M6) runs the worker.
 */
import { PgBoss } from "pg-boss";
import { IMPORT_QUEUE } from "./jobs";

let promise: Promise<PgBoss> | null = null;

export function getBoss(): Promise<PgBoss> | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!promise) {
    promise = (async () => {
      const boss = new PgBoss({ connectionString: url });
      await boss.start();
      await boss.createQueue(IMPORT_QUEUE);
      return boss;
    })();
    promise.catch(() => {
      promise = null;
    });
  }
  return promise;
}
