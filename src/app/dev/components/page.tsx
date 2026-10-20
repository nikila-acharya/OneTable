"use client";

/**
 * WP-0.6 component gallery (PRD 16.8: "a Storybook or /dev/components page").
 * Development only: every request in production gets a 404.
 */

import { notFound } from "next/navigation";
import { useState } from "react";
import {
  OtButton,
  OtChip,
  OtField,
  OtSheet,
  OtToggle,
  AllergyChip,
  ClinicianNote,
} from "@/components/ui/controls";
import {
  OtCard,
  OtMealBar,
  OtSegmented,
  OtStatusChip,
  OtTabBar,
  type TabItem,
} from "@/components/ui/base";

const TABS: TabItem<"plan" | "recipes" | "groceries" | "household">[] = [
  { id: "plan", label: "Plan" },
  { id: "recipes", label: "Recipes" },
  { id: "groceries", label: "Groceries" },
  { id: "household", label: "Household" },
];

export default function ComponentGallery() {
  if (process.env.NODE_ENV === "production") notFound();

  const [seg, setSeg] = useState<"week" | "day">("week");
  const [tab, setTab] = useState<"plan" | "recipes" | "groceries" | "household">("plan");
  const [chip, setChip] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 16, paddingBottom: 96, display: "grid", gap: 20 }}>
      <h1 style={{ fontWeight: 300, fontSize: 26 }}>Components</h1>

      <section aria-label="Buttons and chips" style={{ display: "grid", gap: 10 }}>
        <OtButton>Plan our first week</OtButton>
        <OtButton kind="ghost">Skip for now</OtButton>
        <OtChip label="Thai" selected={chip} onToggle={() => setChip((v) => !v)} />
        <AllergyChip allergen="Peanuts" />
        <OtToggle label="Agent processing consent" checked={chip} onChange={setChip} />
      </section>

      <section aria-label="Fields" style={{ display: "grid", gap: 10 }}>
        <OtField label="Household name" htmlFor="gallery-hh">
          <input id="gallery-hh" defaultValue="The Acharyas" />
        </OtField>
        <ClinicianNote />
      </section>

      <section aria-label="Segmented control" style={{ display: "grid", gap: 8 }}>
        <OtSegmented<"week" | "day">
          label="View"
          value={seg}
          onChange={setSeg}
          options={[
            { value: "week", label: "Week" },
            { value: "day", label: "Day" },
          ]}
        />
      </section>

      <section aria-label="Status chips" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <OtStatusChip kind="ok">Passed safety checks</OtStatusChip>
        <OtStatusChip kind="warn">Needs your check</OtStatusChip>
        <OtStatusChip kind="info">Importing recipes</OtStatusChip>
        <OtStatusChip kind="neutral">Starter library</OtStatusChip>
      </section>

      <OtCard tone="stone" heading="Card (stone)">
        <p>Summaries and plan cards.</p>
      </OtCard>

      <section aria-label="Meal bars" style={{ display: "grid", gap: 8 }}>
        <OtMealBar slot="breakfast">Overnight oats</OtMealBar>
        <OtMealBar slot="lunch">Packed: chickpea wrap</OtMealBar>
        <OtMealBar slot="snack">Apple and yogurt</OtMealBar>
        <OtMealBar slot="dinner">Chana masala</OtMealBar>
      </section>

      <section aria-label="Sheet" style={{ display: "grid", gap: 8 }}>
        <OtButton kind="ghost" onClick={() => setSheetOpen(true)}>Open bottom sheet</OtButton>
        <OtSheet
          open={sheetOpen}
          title="Pick a cuisine"
          onClose={() => setSheetOpen(false)}
          onOk={() => setSheetOpen(false)}
        >
          <p>Sheet body. Cancel and OK close it; Esc closes it too.</p>
        </OtSheet>
      </section>

      <OtTabBar tabs={TABS} active={tab} onSelect={setTab} />
    </main>
  );
}
