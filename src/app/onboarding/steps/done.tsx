/** ON01 — the friendly congrats moment after the first plan stub (§16.2, prototype scrDone). */

"use client";

import { OtButton } from "@/components/ui/controls";
import type { OnboardingDraft } from "../store";

export function Done({
  draft,
  onReopen,
  onStartOver,
}: {
  draft: OnboardingDraft;
  onReopen: () => void;
  onStartOver: () => void;
}) {
  const name = draft.household.name.trim();
  return (
    <section aria-label="Setup complete" className="ot-done">
      <div className="ot-brand">
        <div className="ot-logo" aria-hidden="true" />
      </div>
      <h1 style={{ textAlign: "center" }}>
        You're all set{name ? `, ${name}` : ""}! 🎉
      </h1>
      <p className="ot-sub" style={{ textAlign: "center" }}>
        Your household is saved. The Plan, Recipes, Groceries and Household tabs, the approval
        inbox and your agent chat appear with the next milestones — your setup carries over.
      </p>
      <div className="ot-primary">
        <OtButton kind="ghost" full onClick={onReopen}>Reopen the review screen</OtButton>
        <OtButton kind="ghost" full onClick={onStartOver}>Start over (clears the saved draft)</OtButton>
      </div>
    </section>
  );
}
