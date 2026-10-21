/** WP-1.4 — the clinician banner renders the single-source copy (PRD 16.5). */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClinicianNote } from "@/components/ui/controls";
import { CLINICIAN_BANNER_COPY } from "@/lib/conditions/copy";

describe("ClinicianNote", () => {
  it("shows exactly the single-source copy", () => {
    render(<ClinicianNote />);
    expect(screen.getByRole("note").textContent).toContain(CLINICIAN_BANNER_COPY);
  });
});
