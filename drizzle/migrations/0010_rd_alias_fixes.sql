-- 0010_rd_alias_fixes: RD review sheet (2026-11-25) found four mispins in the 0009 seed.
-- Repins were resolved live against the FDC API on 2026-11-25 by .vercel/fix-0010.cjs (kept out of
-- the repo's build path deliberately: 0009 is already applied everywhere, so it is patched forward,
-- never rewritten). khoya/mawa are REMOVED: FDC has no milk-solids record, and a fluid-milk
-- stand-in would understate their energy roughly eightfold (ADR-125 addendum).

UPDATE "fdc_alias" SET "fdc_id"='790085', "description"='Flour, whole wheat, unenriched', "data_type"='Foundation', "per_100g"='{"energyKcal":370,"protein":15.1,"fat":2.73,"carbs":71.2,"fiber":10.6,"sodium":3}'::jsonb, "unit_grams"='{}'::jsonb, "source_note"='USDA FDC #790085 repinned from RD review 2026-11-25; nutrients + foodPortions fetched live 2026-11-25'
  WHERE "food_key" IN ('whole wheat flour', 'atta', 'chapati flour');
UPDATE "fdc_alias" SET "fdc_id"='168936', "description"='Wheat flour, white, all-purpose, enriched, unbleached', "data_type"='SR Legacy', "per_100g"='{"energyKcal":364,"protein":10.3,"fat":0.98,"saturatedFat":0.155,"carbs":76.3,"fiber":2.7,"sugarTotal":0.27,"sodium":2}'::jsonb, "unit_grams"='{"cup":125}'::jsonb, "source_note"='USDA FDC #168936 repinned from RD review 2026-11-25; nutrients + foodPortions fetched live 2026-11-25'
  WHERE "food_key" IN ('wheat flour');
UPDATE "fdc_alias" SET "fdc_id"='171272', "description"='Milk, dry, nonfat, instant, with added vitamin A and vitamin D', "data_type"='SR Legacy', "per_100g"='{"energyKcal":358,"protein":35.1,"fat":0.72,"saturatedFat":0.467,"carbs":52.2,"fiber":0,"sugarTotal":52.2,"sodium":549}'::jsonb, "unit_grams"='{"cup":69.7}'::jsonb, "source_note"='USDA FDC #171272 repinned from RD review 2026-11-25; nutrients + foodPortions fetched live 2026-11-25'
  WHERE "food_key" IN ('milk powder', 'skimmed milk powder', 'dry milk', 'milk solids without sugar');
UPDATE "fdc_alias" SET "fdc_id"='168153', "description"='Kiwifruit, green, raw', "data_type"='SR Legacy', "per_100g"='{"energyKcal":61,"protein":1.14,"fat":0.52,"saturatedFat":0.029,"carbs":14.7,"fiber":3,"sugarTotal":8.99,"sodium":3}'::jsonb, "unit_grams"='{"cup":180}'::jsonb, "source_note"='USDA FDC #168153 repinned from RD review 2026-11-25; nutrients + foodPortions fetched live 2026-11-25'
  WHERE "food_key" IN ('kiwi', 'kiwis');

DELETE FROM "fdc_alias" WHERE "food_key" IN ('khoya', 'mawa');
