/**
 * ON01 step 3 — Family members (PRD §5.0, §16.5, prototype scrMembers/memberSheet).
 *
 * Member sheet: required fields first, everything else under "More about
 * {name}"; allergy/condition/measurement fields locked behind inline consent
 * the first time they open (PV01); under-18 members get no weight field —
 * just the growth line (SG02 / §16.5); listed conditions show the
 * clinician-confirm note right away (SG01).
 */

"use client";

import { useState, type ReactNode } from "react";
import {
  AllergyChip,
  ClinicianNote,
  OtButton,
  OtField,
  OtSheet,
} from "@/components/ui/controls";
import { SheetDate, SheetRadioList, SheetText, SlotSwitch } from "../pickers";
import {
  ageYears,
  CONDITIONS,
  consentAllows,
  grantConsent,
  isUnder18,
  MAJOR_ALLERGENS,
  memberNeedsGeneralGuidance,
  newMember,
  scrubWithoutConsent,
  syncMeals,
  withdrawConsent,
  type Activity,
  type ConsentType,
  type DietaryPattern,
  type MemberDraft,
  type OnboardStep,
  type OnboardingDraft,
  type Sex,
} from "../store";

const SEXES: { label: string; value: Sex }[] = [
  { label: "Female", value: "female" },
  { label: "Male", value: "male" },
  { label: "Prefer not to say", value: "prefer-not" },
];
const ACTIVITY: { label: string; value: Activity }[] = [
  { label: "Sedentary", value: "sedentary" },
  { label: "Low active", value: "low-active" },
  { label: "Active", value: "active" },
  { label: "Very active", value: "very-active" },
];
const PATTERNS: { label: string; value: DietaryPattern }[] = [
  "omnivore", "vegetarian", "vegan", "pescatarian", "halal", "kosher", "other",
].map((p) => ({ label: p, value: p as DietaryPattern }));

/** Condition display labels match design/prototype.html; slugs stay canonical (WP-1.3 enum). */
export function conditionLabel(slug: string): string {
  switch (slug) {
    case "hypertension":
      return "Hypertension (high blood pressure)";
    case "takes medication with food interactions":
      return "Takes medication with food interactions (e.g. warfarin)";
    case "other":
      return "Other (not acted on)";
    default: {
      const c = slug.charAt(0).toUpperCase() + slug.slice(1);
      return c === "Type 1 diabetes" || c === "Type 2 diabetes" ? c : c;
    }
  }
}

export function sexLabel(slug: Sex | null): string {
  return SEXES.find((s) => s.value === slug)?.label ?? "";
}
export function activityLabel(slug: Activity | null): string {
  return ACTIVITY.find((s) => s.value === slug)?.label ?? "";
}

function memberMeta(m: MemberDraft): string {
  const age = ageYears(m);
  const homeCount = ["breakfast", "lunch", "snack", "dinner"].filter((k) => m.homeFor[k as "breakfast"]).length;
  const parts = [
    sexLabel(m.sex),
    age !== null ? `${age} yrs` : "",
    m.activity ? activityLabel(m.activity) : "activity not set",
    m.dietaryPattern ?? "",
    `home for ${homeCount} of 4 meal${homeCount === 1 ? "" : "s"}`,
  ];
  return parts.filter(Boolean).join(" · ");
}

function MemberCard({
  m,
  onEdit,
  onRemove,
}: {
  m: MemberDraft;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="ot-mcard" data-member-id={m.id}>
      <div className="ot-mcard__top">
        <span className="ot-mcard__name">{m.name}</span>
        <span>
          <button type="button" className="ot-iconbtn" onClick={onEdit}>Edit</button>
          <button type="button" className="ot-iconbtn" onClick={onRemove}>Remove</button>
        </span>
      </div>
      <p className="ot-meta">{memberMeta(m)}</p>
      {m.conditions.length > 0 ? (
        <p className="ot-meta">Conditions: {m.conditions.map(conditionLabel).join(", ")}</p>
      ) : null}
      {m.allergies.length > 0 ? (
        <div className="ot-chips">
          {m.allergies.map((a) => (
            <AllergyChip key={a} allergen={a} />
          ))}
        </div>
      ) : null}
      {memberNeedsGeneralGuidance(m) ? <ClinicianNote /> : null}
    </div>
  );
}

/* --------------------------- consent-gated group (PV01) --------------------------- */

function ConsentGate({
  draft,
  update,
  m,
  setM,
  type,
  icon,
  label,
  why,
  renderEditor,
}: {
  draft: OnboardingDraft;
  update: (d: OnboardingDraft) => void;
  m: MemberDraft;
  setM: (patch: Partial<MemberDraft>) => void;
  type: ConsentType;
  icon: string;
  label: string;
  why: string;
  renderEditor: () => ReactNode;
}) {
  const [asked, setAsked] = useState(false);
  const granted = consentAllows(draft.consent, type);

  if (!granted) {
    return (
      <div>
        <button
          type="button"
          className="ot-lockrow"
          aria-expanded={asked}
          onClick={() => setAsked((a) => !a)}
        >
          🔒 {icon} {label}
        </button>
        {asked && (
          <div className="ot-cpanel">
            <div className="ot-consent-panel">
              <b>Allow OneTable to store {label}?</b>
              <p>{why}</p>
              <p className="ot-meta" style={{ marginTop: 8 }}>
                Stored only for your household, with a timestamp. Nothing is shared. You can
                withdraw any time and we delete it right away.
              </p>
              <div className="ot-consent-actions">
                <OtButton kind="ghost" onClick={() => setAsked(false)}>
                  Not now
                </OtButton>
                <OtButton
                  onClick={() => {
                    update({
                      ...draft,
                      consent: grantConsent(draft.consent, type, new Date().toISOString()),
                    });
                    setAsked(false);
                  }}
                >
                  Yes, allow
                </OtButton>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="ot-granted__head">
        <b>{icon} {label}</b>
        <button
          type="button"
          className="ot-iconbtn"
          onClick={() => {
            // Withdraw: consent off, stored data for that type deleted right away (PV01).
            update({
              ...draft,
              consent: withdrawConsent(draft.consent, type, new Date().toISOString()),
              members: draft.members.map((x) => scrubWithoutConsent(x, { ...draft.consent, [type]: { granted: false, at: new Date().toISOString(), policyVersion: draft.consent[type]?.policyVersion ?? "" } })),
            });
            setM(
              type === "allergies"
                ? { allergies: [] }
                : type === "conditions"
                  ? { conditions: [] }
                  : { heightCm: "", weightKg: "" },
            );
          }}
        >
          Change
        </button>
      </div>
      {renderEditor()}
    </div>
  );
}

/* ------------------------------- member sheet ------------------------------- */

type Stage = "main" | "dob" | "sex" | "pat" | "allergy" | "like" | "dislike";

function MemberSheet({
  draft,
  update,
  existing,
  onClose,
}: {
  draft: OnboardingDraft;
  update: (d: OnboardingDraft) => void;
  existing: MemberDraft | null;
  onClose: () => void;
}) {
  const [m, setMState] = useState<MemberDraft>(existing ? { ...existing, homeFor: { ...existing.homeFor } } : newMember());
  const [stage, setStage] = useState<Stage>("main");
  const [moreOpen, setMoreOpen] = useState(false);
  const [err, setErr] = useState("");

  const setM = (patch: Partial<MemberDraft>) => setMState((prev) => ({ ...prev, ...patch }));

  const freeAllergies = m.allergies.filter((a) => !MAJOR_ALLERGENS.includes(a as (typeof MAJOR_ALLERGENS)[number]));

  const handleOk = () => {
    if (stage !== "main") return;
    if (!m.name.trim()) { setErr("Please enter a name."); return; }
    if (m.birthMonth === null || m.birthYear === null) { setErr("Please set the birth month and year."); return; }
    if (!m.sex) { setErr("Please choose a sex option — it selects nutrient ranges."); return; }
    if (!m.activity) { setErr("Please choose an activity level."); return; }

    let member: MemberDraft = { ...m, name: m.name.trim() };
    // Health data only exists with consent (PV01); under-18s never store weight (§16.5).
    member = scrubWithoutConsent(member, draft.consent);
    if (isUnder18(member)) member.weightKg = "";

    const members = existing
      ? draft.members.map((x) => (x.id === member.id ? member : x))
      : [...draft.members, member];
    update({
      ...draft,
      members,
      meals: syncMeals(members, draft.meals),
    });
    onClose();
  };

  return (
    <>
      <OtSheet
        open
        title={existing ? `Edit ${existing.name || "member"}` : "Add a member"}
        okLabel={existing ? "Save" : "Add member"}
        onClose={onClose}
        onOk={handleOk}
      >
        <OtField label="Display name" htmlFor="m-name" required>
          <input
            id="m-name"
            className="ot-input"
            maxLength={40}
            placeholder="e.g. Ana"
            value={m.name}
            onChange={(e) => setM({ name: e.target.value })}
          />
        </OtField>

        <OtField label="Birth month and year" htmlFor="m-dob" required>
          <button type="button" id="m-dob" className="ot-picker" onClick={() => setStage("dob")}>
            <span className={`v${m.birthYear ? "" : " empty"}`}>
              {m.birthYear && m.birthMonth
                ? `${new Date(2000, m.birthMonth - 1).toLocaleString("en-US", { month: "long" })} ${m.birthYear}`
                : "Tap to choose"}
            </span>
            <span className="chev" aria-hidden="true">›</span>
          </button>
        </OtField>

        <OtField label="Sex" htmlFor="m-sex" required hint="for nutrient lookups">
          <button type="button" id="m-sex" className="ot-picker" onClick={() => setStage("sex")}>
            <span className={`v${m.sex ? "" : " empty"}`}>{sexLabel(m.sex) || "Tap to choose"}</span>
            <span className="chev" aria-hidden="true">›</span>
          </button>
        </OtField>

        <OtField label="Activity level" htmlFor="m-act" required>
          <div className="ot-chips" role="group" aria-label="Activity level" id="m-act">
            {ACTIVITY.map((a) => (
              <button
                key={a.value}
                type="button"
                className="ot-chip"
                aria-pressed={m.activity === a.value}
                onClick={() => setM({ activity: a.value })}
              >
                {a.label}
              </button>
            ))}
          </div>
        </OtField>
        <p className="ot-meta">
          A little walk most days is "Low active". Most people are between "Sedentary" and "Active".
        </p>

        <div className={`ot-disclosure${moreOpen ? " ot-disclosure--open" : ""}`}>
          <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
            <span>
              More about <span>{m.name.trim() || "this member"}</span>
            </span>
            <span aria-hidden="true">▾</span>
          </button>
          <div className="ot-disclosure__body">
            <OtField label="Dietary pattern" htmlFor="m-pat" hint="optional">
              <button type="button" id="m-pat" className="ot-picker" onClick={() => setStage("pat")}>
                <span className={`v${m.dietaryPattern ? "" : " empty"}`}>{m.dietaryPattern || "None set"}</span>
                <span className="chev" aria-hidden="true">›</span>
              </button>
            </OtField>
            <label className="ot-att-label" style={{ fontSize: 13, fontWeight: 500 }}>
              Meal attendance <span className="opt">(which meals is {m.name.trim() || "they"} usually home for?)</span>
            </label>
            {([
              ["breakfast", "Breakfast"],
              ["lunch", "Lunch"],
              ["snack", "Mid-day snack"],
              ["dinner", "Dinner"],
            ] as const).map(([k, l]) => (
              <SlotSwitch
                key={k}
                name={l}
                checked={m.homeFor[k]}
                ariaLabel={`Usually home for ${l}`}
                onChange={(v) => setM({ homeFor: { ...m.homeFor, [k]: v } })}
              />
            ))}

            <ConsentGate
              draft={draft}
              update={update}
              m={m}
              setM={setM}
              type="allergies"
              icon="🥜"
              label="Allergies"
              why="We use allergies to keep unsafe recipes out of every meal this member eats. No one else ever sees them."
              renderEditor={() => (
                <div>
                  <div className="ot-chips">
                    {MAJOR_ALLERGENS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        className="ot-chip"
                        aria-pressed={m.allergies.includes(a)}
                        onClick={() =>
                          setM({
                            allergies: m.allergies.includes(a)
                              ? m.allergies.filter((x) => x !== a)
                              : [...m.allergies, a],
                          })
                        }
                      >
                        {a}
                      </button>
                    ))}
                    {freeAllergies.map((a) => (
                      <button
                        key={a}
                        type="button"
                        className="ot-chip"
                        aria-pressed
                        title="Remove"
                        onClick={() => setM({ allergies: m.allergies.filter((x) => x !== a) })}
                      >
                        {a} ✕
                      </button>
                    ))}
                  </div>
                  <button type="button" className="ot-chip ot-chip--add" onClick={() => setStage("allergy")}>
                    + Add an allergy
                  </button>
                </div>
              )}
            />

            <ConsentGate
              draft={draft}
              update={update}
              m={m}
              setM={setM}
              type="conditions"
              icon="🩺"
              label="Health conditions"
              why="Conditions help us plan safely — they switch on extra guardrails. We never give diagnosis or treatment advice, and no one outside your household sees them."
              renderEditor={() => {
                const gated = m.conditions.some((c) => memberNeedsGeneralGuidance({ ...m, conditions: [c] }));
                return (
                  <div>
                    <div className="ot-chips">
                      {CONDITIONS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className="ot-chip"
                          aria-pressed={m.conditions.includes(c)}
                          onClick={() =>
                            setM({
                              conditions: m.conditions.includes(c)
                                ? m.conditions.filter((x) => x !== c)
                                : [...m.conditions, c],
                            })
                          }
                        >
                          {conditionLabel(c)}
                        </button>
                      ))}
                    </div>
                    {gated ? <ClinicianNote /> : null}
                    {m.conditions.includes("celiac disease") ? (
                      <p className="ot-meta">Celiac disease: gluten is filtered out like an allergen.</p>
                    ) : null}
                  </div>
                );
              }}
            />

            <ConsentGate
              draft={draft}
              update={update}
              m={m}
              setM={setM}
              type="measurements"
              icon="📏"
              label="Height and weight"
              why="Measurements refine nutrient targets for adults. They are always optional — never required — and we never plan for weight loss."
              renderEditor={() =>
                isUnder18(m) ? (
                  <div>
                    <p className="ot-growth">
                      We plan for growth, never for weight loss. No weight field is shown for an
                      under-18 member.
                    </p>
                    <OtField label="Height (cm)" htmlFor="h-cm" hint="optional">
                      <input
                        id="h-cm"
                        className="ot-input"
                        inputMode="decimal"
                        placeholder="e.g. 138"
                        value={m.heightCm}
                        onChange={(e) => setM({ heightCm: e.target.value })}
                      />
                    </OtField>
                  </div>
                ) : (
                  <div className="ot-grid2">
                    <OtField label="Height (cm)" htmlFor="h-cm2">
                      <input
                        id="h-cm2"
                        className="ot-input"
                        inputMode="decimal"
                        placeholder="optional"
                        value={m.heightCm}
                        onChange={(e) => setM({ heightCm: e.target.value })}
                      />
                    </OtField>
                    <OtField label="Weight (kg)" htmlFor="h-kg">
                      <input
                        id="h-kg"
                        className="ot-input"
                        inputMode="decimal"
                        placeholder="optional — never required"
                        value={m.weightKg}
                        onChange={(e) => setM({ weightKg: e.target.value })}
                      />
                    </OtField>
                  </div>
                )
              }
            />

            {(["likes", "dislikes"] as const).map((k) => (
              <div key={k}>
                <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginTop: 14 }}>
                  {k === "likes" ? "Likes" : "Dislikes"} <span className="opt">(optional)</span>
                </label>
                <div className="ot-chips">
                  {m[k].map((v) => (
                    <button
                      key={v}
                      type="button"
                      className="ot-chip"
                      aria-pressed
                      title="Remove"
                      onClick={() => setM({ [k]: m[k].filter((x) => x !== v) } as Partial<MemberDraft>)}
                    >
                      {v} ✕
                    </button>
                  ))}
                  <button
                    type="button"
                    className="ot-chip ot-chip--add"
                    onClick={() => setStage(k === "likes" ? "like" : "dislike")}
                  >
                    + {k === "likes" ? "Add a like" : "Add a dislike"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="ot-err" role="alert">{err}</p>
      </OtSheet>

      {stage === "dob" && (
        <SheetDate
          title="Birth month and year"
          month={m.birthMonth}
          year={m.birthYear}
          onClose={() => setStage("main")}
          onPick={(mo, yr) => { setM({ birthMonth: mo, birthYear: yr }); setStage("main"); }}
        />
      )}
      {stage === "sex" && (
        <SheetRadioList
          title="Sex"
          options={SEXES.map((s) => ({ label: s.label, value: s.value }))}
          current={m.sex}
          onClose={() => setStage("main")}
          onPick={(v) => { setM({ sex: v as Sex }); setStage("main"); }}
        />
      )}
      {stage === "pat" && (
        <SheetRadioList
          title="Dietary pattern"
          options={PATTERNS.map((p) => ({ label: p.label, value: p.value }))}
          current={m.dietaryPattern}
          onClose={() => setStage("main")}
          onPick={(v) => { setM({ dietaryPattern: v as DietaryPattern }); setStage("main"); }}
        />
      )}
      {stage === "allergy" && (
        <SheetText
          title="Other allergy"
          label="Another allergy"
          placeholder="e.g. cilantro"
          maxLength={24}
          onClose={() => setStage("main")}
          onOk={(v) => {
            if (!m.allergies.includes(v)) setM({ allergies: [...m.allergies, v] });
            setStage("main");
          }}
        />
      )}
      {(stage === "like" || stage === "dislike") && (
        <SheetText
          title={stage === "like" ? "Add a like" : "Add a dislike"}
          label="Ingredient or cuisine"
          placeholder="e.g. pasta"
          maxLength={24}
          onClose={() => setStage("main")}
          onOk={(v) => {
            const k = stage === "like" ? "likes" : "dislikes";
            if (!m[k].includes(v)) setM({ [k]: [...m[k], v] } as Partial<MemberDraft>);
            setStage("main");
          }}
        />
      )}
    </>
  );
}

/* --------------------------------- screen --------------------------------- */

export function Members({
  draft,
  update,
  goTo,
  goBack,
}: {
  draft: OnboardingDraft;
  update: (d: OnboardingDraft) => void;
  goTo: (n: OnboardStep) => void;
  goBack: () => void;
}) {
  const [sheet, setSheet] = useState<null | { existing: MemberDraft | null }>(null);

  const remove = (id: string) =>
    update({
      ...draft,
      members: draft.members.filter((x) => x.id !== id),
      meals: draft.meals.filter((x) => x.memberId !== id),
    });

  return (
    <section aria-label="Family members">
      <h1>Family members</h1>
      <p className="ot-sub">
        Everyone you want meals planned for. Name, birthday, sex and activity level are all
        that's required — one screen each.
      </p>

      {draft.members.map((m) => (
        <MemberCard key={m.id} m={m} onEdit={() => setSheet({ existing: m })} onRemove={() => remove(m.id)} />
      ))}
      {draft.members.length === 0 ? (
        <div className="ot-card">
          <p>Nobody added yet. Start with yourself — or whoever plans the food.</p>
        </div>
      ) : null}

      <div className="ot-primary">
        <OtButton full onClick={() => setSheet({ existing: null })}>+ Add a member</OtButton>
        {draft.members.length > 0 ? (
          <OtButton full onClick={() => goTo(4)}>Continue to meals ›</OtButton>
        ) : null}
        <div className="ot-navrow">
          <OtButton kind="ghost" onClick={goBack}>‹ Back</OtButton>
        </div>
      </div>

      {sheet && (
        <MemberSheet draft={draft} update={update} existing={sheet.existing} onClose={() => setSheet(null)} />
      )}
    </section>
  );
}
