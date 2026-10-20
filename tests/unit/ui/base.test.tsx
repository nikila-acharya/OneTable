/**
 * WP-0.6 — behaviour and accessibility of the base components (PRD 16.6).
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { OtCard, OtMealBar, OtSegmented, OtStatusChip, OtTabBar } from "@/components/ui/base";

describe("OtSegmented (radio group, roving focus)", () => {
  it("exposes radio semantics with aria-checked and one tab stop", () => {
    render(
      <OtSegmented
        label="View"
        value="week"
        onChange={() => {}}
        options={[
          { value: "week", label: "Week" },
          { value: "day", label: "Day" },
        ]}
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "View" })).toBeTruthy();
    const week = screen.getByRole("radio", { name: "Week" });
    const day = screen.getByRole("radio", { name: "Day" });
    expect(week.getAttribute("aria-checked")).toBe("true");
    expect(day.getAttribute("aria-checked")).toBe("false");
    expect(week.getAttribute("tabindex")).toBe("0");
    expect(day.getAttribute("tabindex")).toBe("-1");
  });

  it("arrow keys select the next option and wrap around", () => {
    const seen: string[] = [];
    const { container } = render(
      <OtSegmented
        label="View"
        value="week"
        onChange={(v) => seen.push(v)}
        options={[
          { value: "week", label: "Week" },
          { value: "day", label: "Day" },
        ]}
      />,
    );
    const week = within(container).getByRole("radio", { name: "Week" });
    fireEvent.keyDown(week, { key: "ArrowRight" });
    fireEvent.keyDown(week, { key: "ArrowLeft" });
    expect(seen).toEqual(["day", "day"]);
  });
});

describe("OtStatusChip", () => {
  it("states the status in text and marks the glyph decorative", () => {
    render(<OtStatusChip kind="warn">Needs your check</OtStatusChip>);
    expect(screen.getByText("Needs your check")).toBeTruthy();
    const glyph = document.querySelector(".ot-status__glyph");
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("OtMealBar", () => {
  it("prints the slot name so colour is never the only signal", () => {
    render(<OtMealBar slot="dinner">Chana masala</OtMealBar>);
    expect(screen.getByText("Dinner")).toBeTruthy();
    expect(screen.getByText("Chana masala")).toBeTruthy();
  });
});

describe("OtTabBar (PRD 16.2: Plan / Recipes / Groceries / Household)", () => {
  it("marks the active tab with aria-current and selects others on click", () => {
    const picked: string[] = [];
    render(
      <OtTabBar
        tabs={[
          { id: "plan", label: "Plan" },
          { id: "recipes", label: "Recipes" },
          { id: "groceries", label: "Groceries" },
          { id: "household", label: "Household" },
        ]}
        active="plan"
        onSelect={(id) => picked.push(id)}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Plan" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Groceries" }));
    expect(picked).toEqual(["groceries"]);
  });
});

describe("axe (structure and names; colour contrast is checked in tokens.test.ts)", () => {
  it("has no serious or critical violations across the base set", async () => {
    const { container } = render(
      <main>
        <OtCard heading="Plan">
          <OtStatusChip kind="ok">Passed safety checks</OtStatusChip>
        </OtCard>
        <OtSegmented
          label="View"
          value="week"
          onChange={() => {}}
          options={[
            { value: "week", label: "Week" },
            { value: "day", label: "Day" },
          ]}
        />
        <OtMealBar slot="breakfast">Oats</OtMealBar>
        <OtTabBar
          tabs={[{ id: "plan", label: "Plan" }]}
          active="plan"
          onSelect={() => {}}
        />
      </main>,
    );
    const results = await axe(container, { rules: { "color-contrast": { enabled: false } } });
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => v.id)).toEqual([]);
  });
});
