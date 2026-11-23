/**
 * POST /api/plans/first maps planning failures onto distinguishable statuses.
 * The point of this file is the mapping: every condition that used to become a
 * mystery 500 now has its own code, and nothing here should ever 500 for a
 * reason the caller could have been told about.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ householdId: null as string | null }));
const planMock = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock("@/lib/auth", () => {
  class AuthenticationError extends Error {
    readonly status = 401;
  }
  return {
    AuthenticationError,
    requireUser: async () => {
      if (!auth.householdId) throw new AuthenticationError("not signed in");
      return { userId: "u", email: "x@x.invalid", householdId: auth.householdId };
    },
  };
});

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

vi.mock("@/lib/planning/firstPlan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/planning/firstPlan")>();
  return { ...actual, generateWeekPlan: (...a: unknown[]) => planMock.generate(...a) };
});

const call = async () => {
  const { POST } = await import("@/app/api/plans/first/route");
  return POST();
};

beforeEach(() => {
  auth.householdId = "hh-1";
  planMock.generate.mockReset();
});

describe("status mapping", () => {
  it("401 without a session", async () => {
    auth.householdId = null;
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("201 when a plan was created", async () => {
    planMock.generate.mockResolvedValue({ created: true, planId: "p", weekStart: "2026-11-16", seed: 1, slots: 21, status: "draft", meals: [] });
    const res = await call();
    expect(res.status).toBe(201);
    expect((await res.json()).created).toBe(true);
  });

  it("200 and nothing written when this week already has a plan", async () => {
    planMock.generate.mockResolvedValue({ created: false, planId: "p", weekStart: "2026-11-16", seed: 1, slots: 21, status: "accepted", meals: [] });
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).created).toBe(false);
  });

  it("409 for a household-state failure, with the reason in the body", async () => {
    const { PlanError } = await import("@/lib/planning/firstPlan");
    planMock.generate.mockRejectedValue(new PlanError("no_recipes", "no recipes are available for this household yet", { reason: null }));
    const res = await call();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("no_recipes");
    expect(body.message).toMatch(/no recipes/i);
  });

  it("501 for a capability the app does not have yet, so it is not mistaken for a bug", async () => {
    const { PlanError } = await import("@/lib/planning/firstPlan");
    planMock.generate.mockRejectedValue(new PlanError("pool_blocked", "stored recipes carry no diet provenance", { reason: "diet_provenance_unavailable" }));
    const res = await call();
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({
      error: "pool_blocked",
      detail: { reason: "diet_provenance_unavailable" },
    });
  });

  it("500 only for the genuinely unexpected, and it says nothing beyond server_error", async () => {
    const boom = new Error("connection to host ep-example.neon.tech failed for user neondb_owner");
    planMock.generate.mockRejectedValue(boom);
    const res = await call();
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe('{"error":"server_error"}');
    expect(text).not.toContain("neon");
    expect(text).not.toContain("neondb_owner");
  });
});
