/** WP-2.1 — CP01 background import on pg-boss (live DB; fetch is faked, no network). */
import { config } from "dotenv";
import { describe, expect, it } from "vitest";

config({ path: ".env.local" }); // local dev DB; CI sets DATABASE_URL itself
import { startBoss, enqueueImport, makeImportHandler, IMPORT_QUEUE, WORK_OPTIONS } from "../../src/lib/intake/jobs";
import { createFetcher } from "../../src/lib/intake/fetcher";

const hasDb = Boolean(process.env.DATABASE_URL);

async function waitForOutput(boss: Awaited<ReturnType<typeof startBoss>>, jobId: string) {
  for (let i = 0; i < 60; i++) {
    const job = await boss.getJobById(IMPORT_QUEUE, jobId);
    if (job && (job.state === "completed" || job.state === "failed")) return job;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("job did not finish");
}

describe.skipIf(!hasDb)("CP01 import queue (live DB)", () => {
  it("refuses a private link without queuing anything", async () => {
    const boss = await startBoss(process.env.DATABASE_URL!);
    try {
      const r = await enqueueImport(boss, { householdId: "00000000-0000-0000-0000-000000000000", url: "http://192.168.0.10/recipe" });
      expect(r.ok).toBe(false);
    } finally {
      await boss.stop({ graceful: false });
    }
  }, 60_000);

  it("a public blog page runs as a job; a robots-disallowed path is skipped with the reason stored", async () => {
    const boss = await startBoss(process.env.DATABASE_URL!);
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /private/", { status: 200 });
      if (url.endsWith("/recipes/soup")) return new Response("<html>soup</html>", { status: 200, headers: { "content-type": "text/html" } });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const fetcher = createFetcher({ fetchImpl: fakeFetch, now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 50))) });
    try {
      await boss.work(IMPORT_QUEUE, WORK_OPTIONS, makeImportHandler(fetcher));
      const ok = await enqueueImport(boss, { householdId: "00000000-0000-0000-0000-000000000000", url: "https://blog.example.test/recipes/soup" });
      const skipped = await enqueueImport(boss, { householdId: "00000000-0000-0000-0000-000000000000", url: "https://blog.example.test/private/x" });
      expect(ok.ok && skipped.ok).toBe(true);
      if (!ok.ok || !skipped.ok) return;
      const okJob = await waitForOutput(boss, ok.jobId);
      const skipJob = await waitForOutput(boss, skipped.jobId);
      expect(okJob.state).toBe("completed");
      expect((okJob.output as { status: string }).status).toBe("ok");
      expect(skipJob.state).toBe("completed");
      const out = skipJob.output as { status: string; reason: string; message: string };
      expect(out.status).toBe("skipped");
      expect(out.reason).toBe("robots_disallowed");
      expect(out.message).toMatch(/robots\.txt does not allow this page/);
    } finally {
      await boss.stop({ graceful: false });
    }
  }, 120_000);
});
