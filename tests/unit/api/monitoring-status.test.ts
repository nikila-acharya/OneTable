/**
 * /api/monitoring/status — guard behaviour and the two privacy properties that
 * justify the route existing: it must not authorise a prefix of the token, and a
 * database failure must not echo connection details.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({ mode: "ok" as "ok" | "throw" }));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    execute: async () => {
      if (dbState.mode === "throw") {
        throw new Error(
          "connection to server at \"ep-example-pooler.us-east-2.aws.neon.tech\" (10.0.0.5) failed: password authentication failed for user \"neondb_owner\"",
        );
      }
      return [{ one: 1 }];
    },
  }),
}));

const TOKEN = "monitoring-secret-value-abc123";
const route = () => import("@/app/api/monitoring/status/route");

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/monitoring/status", { headers });
}

beforeEach(() => {
  dbState.mode = "ok";
  vi.stubEnv("MONITORING_TOKEN", TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("guard", () => {
  it("answers 501 rather than silently allowing everything when unconfigured", async () => {
    vi.stubEnv("MONITORING_TOKEN", "");
    const res = await (await route()).GET(request({ "x-monitoring-token": TOKEN }));
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: "monitoring_not_configured" });
  });

  it("rejects a missing header", async () => {
    const res = await (await route()).GET(request());
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token", async () => {
    const res = await (await route()).GET(request({ "x-monitoring-token": "not-it" }));
    expect(res.status).toBe(401);
  });

  it("rejects a prefix of the real token (starts-with would have passed)", async () => {
    const res = await (await route()).GET(request({ "x-monitoring-token": TOKEN.slice(0, 12) }));
    expect(res.status).toBe(401);
  });

  it("rejects a same-length token that differs at the last character", async () => {
    const almost = `${TOKEN.slice(0, -1)}${TOKEN.endsWith("3") ? "4" : "3"}`;
    const res = await (await route()).GET(request({ "x-monitoring-token": almost }));
    expect(res.status).toBe(401);
  });

  it("rejects an inserted internal space", async () => {
    // NOT a whitespace-tolerance test: the Headers API trims OWS from values per
    // the Fetch spec, so a leading/trailing space never reaches the route and a
    // test of that would be testing undeliverable input. Internal differences
    // do arrive, and an exact match must reject them.
    const padded = `${TOKEN.slice(0, 10)} ${TOKEN.slice(10)}`;
    const res = await (await route()).GET(request({ "x-monitoring-token": padded }));
    expect(res.status).toBe(401);
  });

  it("accepts the exact token", async () => {
    const res = await (await route()).GET(request({ "x-monitoring-token": TOKEN }));
    expect(res.status).toBe(200);
  });
});

describe("body", () => {
  const auth = () => ({ "x-monitoring-token": TOKEN });

  it("describes this instance, not the deployment", async () => {
    const body = await (await (await route()).GET(request(auth()))).json();
    expect(body.scope).toBe("instance");
    expect(typeof body.uptimeSec).toBe("number");
    expect(body.checks.database.status).toBe("ok");
    expect(typeof body.checks.database.latencyMs).toBe("number");
  });

  it("says honestly that error reporting and persisted metrics are absent", async () => {
    const body = await (await (await route()).GET(request(auth()))).json();
    expect(body.errorReporting).toBe("not_implemented");
    expect(body.persistedMetrics).toBe(false);
  });

  it("reports integration presence as booleans, never values", async () => {
    vi.stubEnv("PAGERDUTY_KEY", "pd-secret-should-never-appear");
    vi.stubEnv("DATADOG_API_KEY", "dd-secret-should-never-appear");
    const res = await (await route()).GET(request(auth()));
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.integrations).toEqual({ pagerduty: true, datadog: true, sentry: false });
    expect(text).not.toContain("pd-secret-should-never-appear");
    expect(text).not.toContain("dd-secret-should-never-appear");
  });

  it("never echoes the monitoring token", async () => {
    const text = await (await (await route()).GET(request(auth()))).text();
    expect(text).not.toContain(TOKEN);
  });

  it("degrades without leaking host, port or user when the database fails", async () => {
    dbState.mode = "throw";
    const res = await (await route()).GET(request(auth()));
    const text = await res.text();
    expect(res.status).toBe(503);
    const body = JSON.parse(text);
    expect(body.status).toBe("degraded");
    expect(body.checks.database).toEqual({ status: "unreachable" });
    expect(text).not.toContain("neon");
    expect(text).not.toContain("10.0.0.5");
    expect(text).not.toContain("neondb_owner");
    expect(text).not.toContain("password");
    expect(text).not.toContain("authentication");
  });

  it("exposes no household, member or user fields", async () => {
    const body = await (await (await route()).GET(request(auth()))).json();
    const text = JSON.stringify(body);
    for (const forbidden of ["household", "member", "email", "consent", "allerg", "recipe"]) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
  });
});
