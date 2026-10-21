# ADR 008 - Onboarding to backend (WP-1.6, slice 1)

Date: 2026-10-21 - Status: accepted for the write path; the submit route and signup are not decided yet
Relates to: PRD 5.0 (ON01), PR01, PR02, PR03, PV01, AC01; ADR-004, ADR-005, ADR-006, ADR-007

## Decisions
1. **Vocabulary mapping lives in one place** (src/lib/onboarding/mapping.ts). The UI keeps its words; the backend keeps PRD/DB words.
   - sex: female/male kept; prefer-not -> unspecified.
   - activity: sedentary kept; low-active -> light; active -> moderate; very-active -> high; unanswered -> moderate (the backend default).
   - diet: other -> unspecified (no backend slot for "other").
   - consent: allergies kept; conditions -> health_conditions; measurements -> body_measurements.
   Owner may prefer a different activity mapping; it is a one-function change.
2. **Validate everything before any write.** completeOnboarding refuses a draft that fails profile, health, under-13 or tier checks, and writes nothing (tested).
3. **Consent before health.** Allergies, conditions and measurements are written only for categories the household granted. Height and weight without measurement consent are stored as nothing (tested).
4. **Attendance:** the UI has one meal pattern per member, not per weekday, so it applies to all seven weekdays. The UI's second snack has no backend slot and is dropped. Packed lunch maps to packed=true on lunch only.

## Known gaps (not closed in this slice)
- **Not persisted yet:** cuisines, weekday breakfast and weeknight dinner minutes, and budget feel. These need a household settings table (PRD 5.0 step 2). Flagged, not invented.
- **Not one transaction:** the writes are sequential service calls. Validation runs first, so only a database error mid-write can leave partial data. Making it atomic means the services must accept a transaction handle; that is a refactor for a later WP.
- **Consent withdrawals in the draft are not written** (only grants). Withdrawals happen later, through the consent panel.
- **No submit route and no signup yet.** Onboarding runs before sign-in and must create the household and its first user. That is a product/auth decision that needs the owner (see WP-1.6 notes).
