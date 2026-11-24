/**
 * Step 6 → the real first-plan pipeline (PR-3). Rendered directly so mount order
 * is controlled: `sourceCards` is read in an effect, so a test that installs its
 * fetch stub after mounting can never exercise the import branch.
 *
 * These replaced the assertions that pinned the stub's copy
 * ("✓ Passed safety checks", "planner arrives with milestone M3", four animated
 * progress lines). The screen now either shows the week the server drafted or the
 * server's plain reason for not drafting it - and each case below checks the
 * message came from the response, not from a script.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Review } from "./review";
import { newDraft, newMember, STORAGE_KEY, type OnboardingDraft } from "../store";

vi.setConfig({ testTimeout: 60_000 });

type Reply = { status: number; body: unknown };

function draftWith(sources = 2): OnboardingDraft {
  const d = newDraft();
  d.step = 6;
  d.completed = [1, 2, 3, 4, 5];
  d.household.name = "Plan Flow Family";
  d.members = [{ ...newMember(), id: "m1", name: "Ana", birthYear: 1990, birthMonth: 3, sex: "female", activity: "active" }];
  d.meals = [{ memberId: "m1", breakfast: true, lunch: false, snack: false, secondSnack: false, dinner: true, packedLunch: "" }];
  d.consent = { allergies: { granted: true, at: "2026-10-16T00:00:00.000Z", policyVersion: "2026-10-16" } };
  void sources;
  return d;
}

const PLAN = {
  created: true,
  planId: "p1",
  weekStart: "2026-11-16",
  seed: 3,
  slots: 3,
  status: "draft",
  meals: [
    { date: "2026-11-16", mealType: "breakfast", recipeId: "r1", recipeName: "Masala Oats" },
    { date: "2026-11-16", mealType: "lunch", recipeId: "r2", recipeName: "Rajma Chawal" },
    { date: "2026-11-16", mealType: "dinner", recipeId: "r3", recipeName: "Dal Tadka" },
  ],
};

const SOURCES_BODY = {
  sources: [
    { url: "https://a.test/1", creatorName: "A Kitchen", chip: { kind: "website", text: "website" } },
    { url: "https://b.test/2", creatorName: null, chip: { kind: "website", text: "website" } },
  ],
};

/** Routes fetches and records them in call order. */
function installFetch(replies: Record<string, Reply>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${path}`);
      const r = replies[path] ?? { status: 200, body: { ok: true } };
      return new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

type SubmitResult = { ok: true } | { ok: false; message: string };

function renderReview(draft = draftWith(), submit?: () => Promise<SubmitResult>) {
  const update = vi.fn();
  const submitMock = vi.fn<() => Promise<SubmitResult>>(submit ?? (async () => ({ ok: true })));
  render(
    <Review
      draft={draft}
      update={update}
      goTo={vi.fn()}
      goBack={vi.fn()}
      submitDraft={submitMock}
    />,
  );
  return { update, submit: submitMock };
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draftWith()));
});

describe("step 6 first-plan pipeline", () => {
  it("saves, reads links, imports, then plans - in that order", async () => {
    const calls = installFetch({
      "/api/sources": { status: 200, body: SOURCES_BODY },
      "/api/sources/import": {
        status: 200,
        body: {
          imported: [{ url: "https://a.test/1", status: "imported" }],
          skipped: [{ url: "https://b.test/2", status: "skipped", reason: "The site did not return this page." }],
          alreadyImported: 1,
          remaining: 4,
          nutritionConfigured: true,
          plannerReady: 1,
        },
      },
      "/api/plans/first": { status: 201, body: PLAN },
    });
    const { submit } = renderReview();
    // wait for the sources to land first: pressing before they load would (rightly)
    // skip the import branch, and this test is about the order when they ARE known
    // the row renders "{creatorName} — {chip}" as one element, so match a prefix
    await screen.findByText(/^A Kitchen/);

    fireEvent.click(screen.getByRole("button", { name: "Plan our first week" }));

    const drafted = await screen.findByRole("group", { name: "Drafted week" });
    // submitDraft is the injected mock, so it produces no fetch of its own here
    expect(calls).toEqual([
      "GET /api/sources",
      "POST /api/sources/import",
      "POST /api/plans/first",
    ]);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(within(drafted).getByText("Masala Oats")).toBeTruthy();
    expect(within(drafted).getByText(/3 meal\s*slots/)).toBeTruthy();
    // the import summary is shown in the server's own numbers, not a script
    expect(within(drafted).getByText(/1 of 3 links read/)).toBeTruthy();
    expect(within(drafted).getByText(/1 already in your library/)).toBeTruthy();
    expect(within(drafted).getByText(/1 skipped \(the site did not return this page/)).toBeTruthy();
    expect(within(drafted).getByText(/4 still waiting/)).toBeTruthy();
  });

  it("does not call the importer when nothing is linked", async () => {
    const calls = installFetch({
      "/api/sources": { status: 200, body: { sources: [] } },
      "/api/plans/first": { status: 201, body: PLAN },
    });
    renderReview();

    fireEvent.click(screen.getByRole("button", { name: "Plan our first week" }));
    await screen.findByRole("group", { name: "Drafted week" });
    expect(calls).toEqual(["GET /api/sources", "POST /api/plans/first"]);
  });

  it("shows the server's reason and next step when there are no recipes", async () => {
    installFetch({
      "/api/sources": { status: 200, body: { sources: [] } },
      "/api/plans/first": {
        status: 409,
        body: { error: "no_recipes", message: "no recipes are available for this household yet" },
      },
    });
    renderReview();

    fireEvent.click(screen.getByRole("button", { name: "Plan our first week" }));
    const alert = await screen.findByRole("alert", { name: "First plan result" });
    expect(within(alert).getByText(/no recipes are available/i)).toBeTruthy();
    expect(within(alert).getByText(/link a few recipe pages/i)).toBeTruthy();
    expect(within(alert).getByRole("button", { name: "Finish without a plan ›" })).toBeTruthy();
    // nothing claims a plan exists
    expect(screen.queryByRole("group", { name: "Drafted week" })).toBeNull();
    expect(screen.queryByText(/Passed safety checks/)).toBeNull();
  });

  it("states the diet-provenance refusal without dressing it up as an error", async () => {
    installFetch({
      "/api/sources": { status: 200, body: { sources: [] } },
      "/api/plans/first": {
        status: 501,
        body: {
          error: "pool_blocked",
          message: "no available recipe carries the diet assertion this household's members declared",
        },
      },
    });
    renderReview();

    fireEvent.click(screen.getByRole("button", { name: "Plan our first week" }));
    const alert = await screen.findByRole("alert", { name: "First plan result" });
    expect(within(alert).getByText(/diet assertion/i)).toBeTruthy();
    expect(within(alert).getByText(/nothing was guessed/i)).toBeTruthy();
  });

  it("reports an existing week as already drafted instead of claiming a new one", async () => {
    installFetch({
      "/api/sources": { status: 200, body: { sources: [] } },
      "/api/plans/first": { status: 200, body: { ...PLAN, created: false } },
    });
    const { update } = renderReview(draftWith());

    fireEvent.click(screen.getByRole("button", { name: "Plan our first week" }));
    const drafted = await screen.findByRole("group", { name: "Drafted week" });
    expect(within(drafted).getByText(/already drafted for this week/)).toBeTruthy();
    // the draft had no request flag, so pressing still records one - the point
    // is that the *week* was not recreated, which the server reports and we show
    expect(update).toHaveBeenCalledTimes(1);
    const next = update.mock.calls[0][0] as OnboardingDraft;
    expect(next.firstPlanRequestedAt).toBeTruthy();
  });

  it("stops before planning when the draft itself is refused", async () => {
    const calls = installFetch({
      "/api/sources": { status: 200, body: { sources: [] } },
      "/api/plans/first": { status: 201, body: PLAN },
    });
    const submit = vi.fn(async () => ({ ok: false as const, message: "this plan includes 12 members, but a household can have at most 10" }));
    renderReview(draftWith(), submit);

    fireEvent.click(screen.getByRole("button", { name: "Plan our first week" }));
    const alert = await screen.findByRole("alert", { name: "First plan result" });
    expect(within(alert).getByText(/at most 10/)).toBeTruthy();
    // nothing was asked of the planner after a rejected save
    // submitDraft is injected here (the real app wires it to /api/onboarding/complete),
    // so the assertion that matters is that the planner was never asked for a week.
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
  });

  it("surfaces an unexpected failure as a plain reason, never as a fake week", async () => {
    installFetch({
      "/api/sources": { status: 200, body: { sources: [] } },
      "/api/plans/first": { status: 500, body: { error: "server_error" } },
    });
    renderReview();

    fireEvent.click(screen.getByRole("button", { name: "Plan our first week" }));
    const alert = await screen.findByRole("alert", { name: "First plan result" });
    expect(within(alert).getByText(/could not draft the week/i)).toBeTruthy();
    expect(within(alert).getByText(/nothing was changed/i)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Drafted week" })).toBeNull();
  });

  it("keeps the button disabled while work is in flight, so double taps cannot stack", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        if (String(input) === "/api/sources") {
          return new Response(JSON.stringify({ sources: [] }), { status: 200, headers: { "content-type": "application/json" } });
        }
        await gate;
        return new Response(JSON.stringify(PLAN), { status: 201, headers: { "content-type": "application/json" } });
      }),
    );
    renderReview();

    const button = screen.getByRole("button", { name: "Plan our first week" });
    fireEvent.click(button);
    await screen.findByText("Drafting your week");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    release();
    await screen.findByRole("group", { name: "Drafted week" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("labels the week honestly while it is being produced", async () => {
    installFetch({
      "/api/sources": { status: 200, body: { sources: [] } },
      "/api/plans/first": { status: 201, body: PLAN },
    });
    renderReview();

    fireEvent.click(screen.getByRole("button", { name: "Plan our first week" }));
    const progress = await screen.findByRole("status", { name: "First plan progress" });
    expect(within(progress).queryByText(/Checking allergies against every recipe/)).toBeNull();
    expect(within(progress).queryByText(/Reading the starter library/)).toBeNull();
    await screen.findByRole("group", { name: "Drafted week" });
  });
});
