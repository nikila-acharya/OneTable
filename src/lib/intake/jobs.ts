/**
 * CP01 background imports on pg-boss (PRD 10.1 / 15: Postgres-backed queue, no extra
 * infrastructure). A job is one URL; its result (ok or a plain-words skip) is the
 * job's stored output, so the app can show what came in and what did not.
 */
import { PgBoss } from "pg-boss";
import { checkPublicUrl } from "./url";
import type { createFetcher } from "./fetcher";

export const IMPORT_QUEUE = "cp01-import";

export interface ImportJobData {
  householdId: string;
  url: string;
}

export interface ImportJobOutput {
  url: string;
  status: "ok" | "skipped";
  reason?: string;
  message?: string;
  bytes?: number;
}

export async function startBoss(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss(connectionString);
  await boss.start();
  await boss.createQueue(IMPORT_QUEUE);
  return boss;
}

/** Refuses a non-public link before anything is queued. Returns the job id, or the reason. */
export async function enqueueImport(
  boss: PgBoss,
  input: { householdId: string; url: unknown },
): Promise<{ ok: true; jobId: string } | { ok: false; reason: string }> {
  const check = checkPublicUrl(input.url);
  if (!check.ok) return { ok: false, reason: check.reason };
  const jobId = await boss.send(IMPORT_QUEUE, { householdId: input.householdId, url: check.url } satisfies ImportJobData);
  if (!jobId) return { ok: false, reason: "That link is already being imported." };
  return { ok: true, jobId };
}

/** Use with boss.work(IMPORT_QUEUE, WORK_OPTIONS, handler): each job gets its own output. */
export const WORK_OPTIONS = { perJobResults: true } as const;

export function makeImportHandler(fetcher: ReturnType<typeof createFetcher>) {
  return async (jobs: { id: string; data: ImportJobData }[]) => {
    const results: { id: string; status: "completed"; output: ImportJobOutput }[] = [];
    for (const job of jobs) {
      const r = await fetcher.fetchPage(job.data.url);
      const output: ImportJobOutput =
        r.status === "ok"
          ? { url: r.url, status: "ok", bytes: r.body.length }
          : { url: r.url, status: "skipped", reason: r.reason, message: r.message };
      results.push({ id: job.id, status: "completed", output });
    }
    return results;
  };
}
