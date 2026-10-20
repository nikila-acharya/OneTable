/**
 * OneTable — demo seed for two households (NF-7). WP-0.2.
 *
 *  - "Busy Parent Household": one working mum, kids aged 11 & 6; Sam (11) has
 *    a peanut + tree-nut allergy (locked never-plan rules) and asthma; kids on
 *    school lunches weekdays; Friday pizza night memory.
 *  - "Fitness Couple Household": two adults (athlete / high activity), one
 *    prediabetes condition (SG01 gate demo data), shellfish allergy; activity
 *    goals + a check-in for the demo week.
 *
 * Health payloads are stored ENCRYPTED only (AES-256-GCM, db/crypto.ts, NF-P1).
 * Child profiles carry no weight — seeded on purpose (PR01 no-weight-talk).
 * Each household gets: consents (PV01), a source, prefs, full attendance,
 * a draft 28-slot week, a plan_rule_check proof, and a v1 grocery list.
 * Starter-library recipes and shared food items are household-independent.
 *
 * Re-runnable: applies committed migrations, then truncates its footprint —
 * guarded to databases named `onetable` / `onetable_dev` unless forced.
 */
import { sql as ds } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { encryptHealth } from './crypto.js';
import type { Db } from './index.js';
import {
  activityCheckin,
  activityGoal,
  allergenConfirmation,
  appUser,
  consent,
  foodItem,
  groceryItem,
  groceryList,
  household,
  member,
  memberAttendance,
  memberHealth,
  memberPref,
  memoryEntry,
  plan,
  planRuleCheck,
  planSlot,
  recipe,
  recipeIngredient,
  recipeNutrients,
  recipeStep,
  slotMember,
  source,
  tip,
  type MealType,
} from './schema.js';

export type SeedOptions = {
  /** Skip the truncate step (only when the tables are known to be empty). */
  skipTruncate?: boolean;
  /** Wipe even if the database is not named onetable/onetable_dev. */
  force?: boolean;
  /** Apply committed migrations before seeding (default true). */
  migrateFirst?: boolean;
};

const MEALS: MealType[] = ['breakfast', 'lunch', 'snack', 'dinner'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]; // 0=Sun … 6=Sat
const WEEKDAYS = [1, 2, 3, 4, 5];

/** strict-mode helper: first row of a .returning()/select result or loud fail */
function one<T>(rows: T[]): T {
  const r = rows[0];
  if (r === undefined) throw new Error('[seed] expected at least one row');
  return r;
}

/** Next Monday as YYYY-MM-DD (local); the demo plan's week_start. */
export function nextMonday(from = new Date()): string {
  const d = new Date(from);
  const delta = ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function assertDevDatabase(url: string, force: boolean): void {
  if (force) return;
  let dbName = '';
  try {
    dbName = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error('[seed] DATABASE_URL is not a valid URL');
  }
  if (!/^onetable(_dev)?$/i.test(dbName)) {
    throw new Error(
      `[seed] refusing to wipe database "${dbName}" — demo seeds require a database named onetable or onetable_dev (pass { force: true } to override).`,
    );
  }
}

async function truncateAll(db: Db): Promise<void> {
  // Cascade takes every child table; starter-library rows have null household
  // ids so recipe/food_item/tip/clinician_target must be listed explicitly.
  await db.execute(
    ds`truncate table household, recipe, food_item, tip, clinician_target restart identity cascade`,
  );
}

type MemberSpec = {
  key: string;
  name: string;
  birthYm: string;
  sex: 'male' | 'female' | 'other' | 'unspecified';
  activity: 'sedentary' | 'light' | 'moderate' | 'high' | 'athlete';
  diet: 'omnivore' | 'vegetarian' | 'vegan' | 'pescatarian' | 'halal' | 'kosher' | 'gluten_free' | 'dairy_free' | 'unspecified';
  isChild: boolean;
  health: {
    heightCm: number | null;
    weightKg: number | null; // MUST be null for children (PR01)
    conditions: string[];
    allergies: string[];
    otherAllergens: string[];
  };
  likes: string[];
  dislikes: string[];
  /** per meal: on which weekdays they are away; attending overall flag */
  attendance: Record<MealType, { attending: boolean; packed: boolean; weekdays: number[] }>;
};

const BUSY_PARENTS: MemberSpec[] = [
  {
    key: 'maya', name: 'Maya', birthYm: '1988-03', sex: 'female', activity: 'light',
    diet: 'omnivore', isChild: false,
    health: { heightCm: 165, weightKg: 68, conditions: [], allergies: [], otherAllergens: [] },
    likes: ['ethiopian food', 'one-pan dinners'], dislikes: ['organ meats'],
    attendance: {
      breakfast: { attending: true, packed: false, weekdays: ALL_DAYS },
      lunch: { attending: false, packed: false, weekdays: ALL_DAYS }, // eats at work (incl. weekends out)
      snack: { attending: true, packed: false, weekdays: ALL_DAYS },
      dinner: { attending: true, packed: false, weekdays: ALL_DAYS },
    },
  },
  {
    key: 'sam', name: 'Sam', birthYm: '2015-02', sex: 'male', activity: 'moderate',
    diet: 'omnivore', isChild: true,
    health: {
      heightCm: 142, weightKg: null, // PR01: no weight on child profiles
      conditions: ['asthma'],
      allergies: ['peanut', 'tree_nut'],
      otherAllergens: [],
    },
    likes: ['pasta', 'pancakes'], dislikes: ['mushrooms'],
    attendance: {
      breakfast: { attending: true, packed: false, weekdays: ALL_DAYS },
      lunch: { attending: false, packed: false, weekdays: WEEKDAYS }, // school lunch Mon–Fri
      snack: { attending: true, packed: true, weekdays: WEEKDAYS },
      dinner: { attending: true, packed: false, weekdays: ALL_DAYS },
    },
  },
  {
    key: 'lily', name: 'Lily', birthYm: '2020-05', sex: 'female', activity: 'moderate',
    diet: 'omnivore', isChild: true,
    health: { heightCm: 116, weightKg: null, conditions: [], allergies: [], otherAllergens: [] },
    likes: ['pancakes', 'strawberries'], dislikes: ['olives'],
    attendance: {
      breakfast: { attending: true, packed: false, weekdays: ALL_DAYS },
      lunch: { attending: false, packed: false, weekdays: WEEKDAYS },
      snack: { attending: true, packed: true, weekdays: WEEKDAYS },
      dinner: { attending: true, packed: false, weekdays: ALL_DAYS },
    },
  },
];

const FITNESS_COUPLE: MemberSpec[] = [
  {
    key: 'nina', name: 'Nina', birthYm: '1991-07', sex: 'female', activity: 'athlete',
    diet: 'vegetarian', isChild: false,
    health: {
      heightCm: 170, weightKg: 63,
      conditions: ['prediabetes'], // SG01 condition-gate demo data
      allergies: [], otherAllergens: [],
    },
    likes: ['high-protein breakfasts', 'thai food'], dislikes: ['diet soda'],
    attendance: {
      breakfast: { attending: true, packed: false, weekdays: ALL_DAYS },
      lunch: { attending: true, packed: false, weekdays: ALL_DAYS },
      snack: { attending: true, packed: false, weekdays: ALL_DAYS },
      dinner: { attending: true, packed: false, weekdays: ALL_DAYS },
    },
  },
  {
    key: 'marco', name: 'Marco', birthYm: '1989-11', sex: 'male', activity: 'high',
    diet: 'pescatarian', isChild: false,
    health: { heightCm: 178, weightKg: 79, conditions: [], allergies: ['shellfish'], otherAllergens: [] },
    likes: ['chili', 'salmon'], dislikes: ['cilantro'],
    attendance: {
      breakfast: { attending: true, packed: false, weekdays: ALL_DAYS },
      lunch: { attending: false, packed: false, weekdays: WEEKDAYS }, // eats out near the gym
      snack: { attending: true, packed: false, weekdays: ALL_DAYS },
      dinner: { attending: true, packed: false, weekdays: ALL_DAYS },
    },
  },
];

type RecipeSeed = {
  title: string;
  starter: boolean;
  cuisine: string;
  meals: MealType[];
  prepMin: number;
  cookMin: number;
  yieldServings: number;
  ingredients: string[];
  uncertainAllergenTags?: string[]; // e.g. 'may contain traces' facility warnings
  steps: string[];
  kcalPerServing: number;
  proteinG: number;
};

const STARTER_RECIPES: RecipeSeed[] = [
  {
    title: 'Friday Pizza Night', starter: true, cuisine: 'italian', meals: ['dinner'],
    prepMin: 20, cookMin: 12, yieldServings: 4,
    ingredients: ['pizza dough', 'tomato sauce', 'mozzarella', 'basil'],
    steps: ['Stretch the dough on a tray.', 'Spread sauce, add cheese.', 'Bake at 250°C until the crust is spotted.'],
    kcalPerServing: 720, proteinG: 28,
  },
  {
    title: 'Monday Veggie Pasta', starter: true, cuisine: 'italian', meals: ['dinner'],
    prepMin: 10, cookMin: 20, yieldServings: 4,
    ingredients: ['pasta', 'zucchini', 'cherry tomatoes', 'parmesan'],
    steps: ['Boil the pasta.', 'Sauté the vegetables.', 'Toss together with parmesan.'],
    kcalPerServing: 540, proteinG: 19,
  },
  {
    title: 'Fluffy Pancakes', starter: true, cuisine: 'american', meals: ['breakfast'],
    prepMin: 10, cookMin: 15, yieldServings: 4,
    ingredients: ['flour', 'milk', 'eggs', 'butter'],
    steps: ['Whisk dry, add wet, rest 10 min.', 'Griddle until bubbles pop, flip once.'],
    kcalPerServing: 320, proteinG: 11,
  },
];

const PRIVATE_RECIPES: Record<'busy' | 'fitness', RecipeSeed[]> = {
  busy: [
    {
      title: 'One-Pan Lemon Chicken & Potatoes', starter: false, cuisine: 'mediterranean',
      meals: ['dinner'], prepMin: 15, cookMin: 45, yieldServings: 4,
      ingredients: ['chicken thighs', 'potatoes', 'lemon', 'oregano'],
      steps: ['Season everything.', 'Roast at 200°C until the juices run clear.'],
      kcalPerServing: 610, proteinG: 42,
    },
    {
      title: 'Nut-Free Granola Bars (may contain traces)', starter: false, cuisine: 'american',
      meals: ['snack'], prepMin: 10, cookMin: 25, yieldServings: 8,
      ingredients: ['rolled oats', 'honey', 'sunflower seed butter', 'dried cranberries'],
      uncertainAllergenTags: ['tree_nut_traces'],
      steps: ['Warm the binder.', 'Mix everything.', 'Press into a tin, bake, cool, slice.'],
      kcalPerServing: 210, proteinG: 6,
    },
  ],
  fitness: [
    {
      title: 'High-Protein Tofu Scramble', starter: false, cuisine: 'american',
      meals: ['breakfast'], prepMin: 5, cookMin: 10, yieldServings: 2,
      ingredients: ['firm tofu', 'turmeric', 'spinach', 'black salt'],
      steps: ['Crumble the tofu.', 'Cook with spices until set.', 'Fold in spinach.'],
      kcalPerServing: 290, proteinG: 24,
    },
    {
      title: 'Salmon Rice Bowl', starter: false, cuisine: 'japanese',
      meals: ['dinner'], prepMin: 10, cookMin: 20, yieldServings: 2,
      ingredients: ['salmon fillet', 'sushi rice', 'edamame', 'soy sauce'],
      steps: ['Cook the rice.', 'Pan-sear the salmon skin-side down.', 'Assemble the bowl.'],
      kcalPerServing: 650, proteinG: 40,
    },
  ],
};

const SHARED_FOODS: { name: string; portion: number; meals: MealType[] }[] = [
  { name: 'Banana', portion: 120, meals: ['breakfast', 'snack'] },
  { name: 'Greek yogurt', portion: 170, meals: ['breakfast', 'snack'] },
  { name: 'Whole-grain toast with cheese', portion: 90, meals: ['breakfast'] },
  { name: 'Apple', portion: 180, meals: ['snack', 'lunch'] },
  { name: 'Hummus & carrot sticks', portion: 150, meals: ['snack', 'lunch'] },
];

const DEMO_TIPS: { text: string; sourceName: string; origin: 'clinical' | 'pool' }[] = [
  {
    text: 'Keep newly introduced allergens out of packed lunches at first, so a reaction stays easy to trace.',
    sourceName: 'Pediatric allergy guidance (public)',
    origin: 'clinical',
  },
  {
    text: 'A protein-rich breakfast makes mid-morning snack time easier on busy school days.',
    sourceName: 'OneTable editorial pool',
    origin: 'pool',
  },
];

async function insertRecipe(db: Db, r: RecipeSeed, householdId: string | null): Promise<string> {
  const row = one(
    await db
      .insert(recipe)
    .values({
      householdId,
      visibility: r.starter ? 'starter' : 'household_private',
      title: r.title,
      cuisine: r.cuisine,
      mealTypes: r.meals,
      yieldServings: r.yieldServings,
      prepMin: r.prepMin,
      cookMin: r.cookMin,
      totalMin: r.prepMin + r.cookMin,
      sourceUrl: r.starter ? null : 'https://demo.example.com/recipes',
      sourceDomain: r.starter ? null : 'demo.example.com',
      author: r.starter ? 'OneTable (owned)' : 'Demo Source',
      parseMethod: 'manual',
      status: 'ready',
      })
      .returning(),
  );
  await db.insert(recipeStep).values(
    r.steps.map((text, position) => ({ recipeId: row.id, position, text })),
  );
  await db.insert(recipeIngredient).values(
    r.ingredients.map((rawText, position) => ({
      recipeId: row.id,
      position,
      rawText,
      uncertainAllergenTags: position === 0 ? r.uncertainAllergenTags ?? [] : [],
    })),
  );
  await db.insert(recipeNutrients).values({
    recipeId: row.id,
    perServing: { kcal: r.kcalPerServing, protein_g: r.proteinG },
    completeness: 0.8,
  });
  return row.id;
}

/** Is this member present for `meal` on `weekday`? (weekdays list = away days) */
function attendsOn(cfg: MemberSpec['attendance'][MealType], weekday: number): boolean {
  return cfg.attending || !cfg.weekdays.includes(weekday);
}

async function seedHousehold(
  db: Db,
  spec: {
    key: 'busy' | 'fitness';
    name: string;
    email: string;
    timezone: string;
    agentPaused: boolean;
    members: MemberSpec[];
  },
  starterRecipeIds: string[],
  foodIds: string[],
): Promise<void> {
  const hh = one(
    await db
      .insert(household)
    .values({
      name: spec.name,
      tier: 'household',
      timezone: spec.timezone,
        agentPaused: spec.agentPaused,
      })
      .returning(),
  );
  const householdId = hh.id;

  await db
    .insert(appUser)
    .values({ householdId, email: spec.email, emailVerified: new Date() });

  // PV01: each sensitive data type gets its own recorded opt-in + policy version.
  await db.insert(consent).values(
    (
      ['health_conditions', 'allergies', 'body_measurements', 'activity_data', 'agent_processing'] as const
    ).map((dataType) => ({
      householdId,
      dataType,
      granted: true,
      policyVersion: '2026-10-01',
    })),
  );

  await db.insert(source).values(
    spec.key === 'busy'
      ? { householdId, kind: 'website', platform: 'website', url: 'https://weeknight.example.com', creatorName: 'Weeknight Cook', status: 'active' }
      : { householdId, kind: 'youtube_channel', platform: 'youtube', url: 'https://youtube.example.com/@strongplate', creatorName: 'Strong Plate', status: 'active' },
  );

  const memberIds: Record<string, string> = {};
  const idOf = (key: string): string => {
    const v = memberIds[key];
    if (!v) throw new Error('[seed] unknown member key: ' + key);
    return v;
  };
  for (const m of spec.members) {
    if (m.isChild && m.health.weightKg !== null) {
      // Fail loudly rather than let a future seed edit sneak weight onto a child.
      throw new Error(`[seed] child profile ${m.name} must not carry weight (PR01)`);
    }
    const row = one(
      await db
        .insert(member)
      .values({
        householdId,
        name: m.name,
        birthYm: m.birthYm,
        sex: m.sex,
        activityLevel: m.activity,
        dietPattern: m.diet,
          isChild: m.isChild,
        })
        .returning(),
    );
    memberIds[m.key] = row.id;

    await db.insert(memberHealth).values({
      memberId: row.id,
      dataEnc: encryptHealth(m.health), // NF-P1: ciphertext only
    });

    await db.insert(memberPref).values([
      ...m.likes.map((item) => ({ memberId: row.id, kind: 'like' as const, item, source: 'onboarding' })),
      ...m.dislikes.map((item) => ({ memberId: row.id, kind: 'dislike' as const, item, source: 'onboarding' })),
    ]);

    const attRows: (typeof memberAttendance.$inferInsert)[] = [];
    for (const meal of MEALS) {
      const cfg = m.attendance[meal];
      for (const weekday of ALL_DAYS) {
        const present = attendsOn(cfg, weekday);
        attRows.push({
          memberId: row.id,
          mealType: meal,
          weekday,
          attending: present,
          packed: present && cfg.packed,
        });
      }
    }
    await db.insert(memberAttendance).values(attRows);
  }

  // Household-private recipes; the planning pool also holds the starter library.
  const privateIds: string[] = [];
  for (const r of PRIVATE_RECIPES[spec.key]) {
    privateIds.push(await insertRecipe(db, r, householdId));
  }
  const sharedPool = [...starterRecipeIds, ...privateIds.filter((_, i) => i !== 1)]; // granola bar is snack-only

  const weekStart = nextMonday();
  const planRow = one(
    await db
      .insert(plan)
    .values({
      householdId,
      weekStart,
      seed: 20261019,
      prefsJson:
        spec.key === 'busy'
          ? { noNuts: true, weekdayDinnerMaxMin: 30 }
          : { highProtein: true, vegetarianFirst: true },
      status: 'draft',
        createdBy: 'agent',
      })
      .returning(),
  );

  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(`${weekStart}T12:00:00`);
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }

  const slotRows: (typeof planSlot.$inferInsert)[] = [];
  days.forEach((dateStr, dayIdx) => {
    for (const meal of MEALS) {
      slotRows.push({
        planId: planRow.id,
        date: dateStr,
        mealType: meal,
        mode: 'shared',
        sharedRecipeId:
          meal === 'snack' ? null : sharedPool[(dayIdx + MEALS.indexOf(meal)) % sharedPool.length],
        locked: meal === 'dinner' && dayIdx === 5 && spec.key === 'busy', // Friday pizza night
      });
    }
  });
  const slots = await db.insert(planSlot).values(slotRows).returning();

  const slotMemberRows: (typeof slotMember.$inferInsert)[] = [];
  slots.forEach((slot, idx) => {
    const weekday = new Date(`${slot.date}T12:00:00`).getDay();
    for (const m of spec.members) {
      if (!attendsOn(m.attendance[slot.mealType], weekday)) continue;
      slotMemberRows.push({
        slotId: slot.id,
        memberId: idOf(m.key),
        attending: true,
        recipeId: slot.mealType === 'snack' ? null : slot.sharedRecipeId,
        foodItemId: slot.mealType === 'snack' ? (foodIds[idx % foodIds.length] ?? null) : null,
      });
    }
  });
  await db.insert(slotMember).values(slotMemberRows);

  await db.insert(planRuleCheck).values({
    planId: planRow.id,
    ruleSetVersion: 'rules@0.0.0',
    detailsJson: { engine: 'placeholder (WP-1.4 wires the real gate)', slotsChecked: slots.length, blockers: 0 },
  });

  const list = one(await db.insert(groceryList).values({ planId: planRow.id, version: 1 }).returning());
  await db.insert(groceryItem).values([
    { listId: list.id, food: 'Chicken thighs', qty: '1.2', unit: 'kg', aisle: 'meat' },
    { listId: list.id, food: 'Potatoes', qty: '1.5', unit: 'kg', aisle: 'produce' },
    { listId: list.id, food: 'Pasta', qty: '500', unit: 'g', aisle: 'dry goods', pantrySkip: spec.key === 'busy' },
    { listId: list.id, food: 'Firm tofu', qty: '600', unit: 'g', aisle: 'refrigerated' },
    { listId: list.id, food: 'Bananas', qty: '10', unit: 'pcs', aisle: 'produce' },
  ]);

  if (spec.key === 'busy') {
    await db.insert(memoryEntry).values([
      {
        householdId,
        type: 'weeknight_pattern',
        value: { day: 'friday', pattern: 'pizza night' },
        source: 'onboarding 2026-10-12',
      },
      {
        householdId,
        memberId: idOf('sam'),
        type: 'dislike',
        value: 'mushrooms',
        source: 'chat 2026-10-12',
      },
    ]);
    // Sam may eat the "may contain traces" bars ONLY after an explicit UI confirmation (PR03):
    const granolaId = one(privateIds.slice(1)); // second busy-private recipe
    await db.insert(allergenConfirmation).values({
      recipeId: granolaId,
      memberId: idOf('sam'),
      confirmedByUserAt: new Date(),
    });
  } else {
    for (const m of spec.members) {
      await db.insert(activityGoal).values({
        memberId: idOf(m.key),
        weekStart,
        targetSessions: m.activity === 'athlete' ? 6 : 4,
      });
      await db.insert(activityCheckin).values({
        memberId: idOf(m.key),
        weekStart,
        status: 'done',
      });
    }
  }
}

/** Migrate + truncate + create the two NF-7 demo households (and shared content). */
export async function seed(db: Db, options: SeedOptions = {}): Promise<void> {
  if (options.migrateFirst !== false) {
    await migrate(db, { migrationsFolder: 'drizzle/migrations' });
  }
  assertDevDatabase(process.env.DATABASE_URL ?? '', options.force === true);
  if (!options.skipTruncate) await truncateAll(db);

  const starterRecipeIds: string[] = [];
  for (const r of STARTER_RECIPES) starterRecipeIds.push(await insertRecipe(db, r, null));

  const foods = await db
    .insert(foodItem)
    .values(
      SHARED_FOODS.map((f) => ({
        name: f.name,
        defaultPortionG: f.portion,
        mealTypes: f.meals,
      })),
    )
    .returning();

  await db.insert(tip).values(
    DEMO_TIPS.map((t) => ({ text: t.text, sourceName: t.sourceName, origin: t.origin })),
  );

  await seedHousehold(
    db,
    {
      key: 'busy',
      name: 'Busy Parent Household',
      email: 'maya@example.com',
      timezone: 'America/New_York',
      agentPaused: false,
      members: BUSY_PARENTS,
    },
    starterRecipeIds,
    foods.map((f) => f.id),
  );

  await seedHousehold(
    db,
    {
      key: 'fitness',
      name: 'Fitness Couple Household',
      email: 'nina@example.com',
      timezone: 'America/Los_Angeles',
      agentPaused: true, // NF-10 demo: the app must still work by hand
      members: FITNESS_COUPLE,
    },
    starterRecipeIds,
    foods.map((f) => f.id),
  );
}
