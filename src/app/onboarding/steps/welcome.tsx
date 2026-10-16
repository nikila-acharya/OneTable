/** ON01 step 1 — Welcome & privacy promise (PRD §5.0, prototype scrWelcome). */

"use client";

import { OtButton } from "@/components/ui/controls";
import type { OnboardingDraft } from "../store";

export function hasSavedDraft(draft: OnboardingDraft): boolean {
  return (
    draft.step > 1 ||
    draft.completed.length > 0 ||
    draft.members.length > 0 ||
    draft.household.name.trim() !== ""
  );
}

export function Welcome({
  draft,
  onStart,
  onStartOver,
}: {
  draft: OnboardingDraft;
  onStart: () => void;
  onStartOver: () => void;
}) {
  const resumable = hasSavedDraft(draft);
  return (
    <section aria-label="Welcome">
      <div className="ot-brand">
        <div className="ot-logo" aria-hidden="true" />
        <div className="ot-wordmark">OneTable</div>
      </div>
      <h1 style={{ textAlign: "center" }}>
        One plan for everyone,
        <br />
        from food you already love.
      </h1>
      <p className="ot-sub" style={{ textAlign: "center", marginTop: 10 }}>
        First, tell us about your household. It takes about three minutes, and it saves after
        every step — you can stop and come back whenever you like.
      </p>
      <ul className="ot-promise">
        <li><i aria-hidden="true" /><span><b>Only you log in.</b></span></li>
        <li><i aria-hidden="true" /><span><b>Health details stay private.</b></span></li>
        <li><i aria-hidden="true" /><span><b>Nothing is shared with advertisers.</b></span></li>
      </ul>
      <p className="ot-consent-hero">
        We’ll ask permission for allergies and health details only at the moment you add them —
        never before.
      </p>
      <div className="ot-primary">
        <OtButton full onClick={onStart}>
          {resumable ? "Continue where you left off ›" : "Get started ›"}
        </OtButton>
        {resumable ? (
          <OtButton kind="ghost" full onClick={onStartOver}>
            Start over (clears the saved draft)
          </OtButton>
        ) : null}
      </div>
    </section>
  );
}
