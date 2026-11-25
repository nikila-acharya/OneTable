-- 0011_rd_pass: dietitian review of the curated alias table is complete (ADR-125 addendum).
-- The RD (signature nk) reviewed all 203 pinned records on 2026-11-25 and approved every
-- food->record mapping. The four mispinned groups caught by the machine cross-check were
-- repaired in migration 0010 BEFORE this flip, and the repaired records hold the same food
-- identity the RD signed for (flour->flour, milk powder->dry milk, kiwi->kiwifruit); the
-- khoya/mawa aliases were removed outright, so nothing reviewed here went unrepaired.
-- This flip is what unlocks any "nutrition reviewed" claim in product copy (PRD 13.3 gate).

UPDATE "fdc_alias" SET "reviewed" = true;
