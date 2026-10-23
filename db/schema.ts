/**

 * OneTable — core data model (PRD 10.3, TR-DATA). WP-0.2.

 *

 * Conventions:

 *  - PostgreSQL 16. Drizzle ORM (postgres-js driver).

 *  - Every household-owned table cascades on delete from `household`

 *    (directly or through its parent) so that "delete household" (PV03)

 *    leaves no row referencing the household id. tests/pv03.test.ts proves it.

 *  - `member_health` stores ONE AES-256-GCM blob (db/crypto.ts) per member —

 *    height, weight, conditions, allergies, other_allergens never exist as

 *    plaintext columns (NF-P1 / NF-P2).

 *  - All schema changes go through a committed SQL file in

 *    drizzle/migrations/ (rule-source culture). Never `db:push` on Neon.

 */

import {

  boolean,

  check,

  date,

  index,

  integer,

  jsonb,

  numeric,

  pgEnum,

  pgTable,

  primaryKey,

  real,

  smallint,

  text,

  timestamp,

  uniqueIndex,

  uuid,

} from 'drizzle-orm/pg-core';



/* ------------------------------------------------------------------ enums */



export const householdTier = pgEnum('household_tier', ['free', 'household']);

export const consentDataType = pgEnum('consent_data_type', [

  'health_conditions',

  'allergies',

  'body_measurements',

  'activity_data',

  'agent_processing',

]);

export const memberSex = pgEnum('member_sex', [

  'male',

  'female',

  'other',

  'unspecified',

]);

export const activityLevel = pgEnum('activity_level', [

  'sedentary',

  'light',

  'moderate',

  'high',

  'athlete',

]);

export const dietPattern = pgEnum('diet_pattern', [

  'omnivore',

  'vegetarian',

  'vegan',

  'pescatarian',

  'halal',

  'kosher',

  'gluten_free',

  'dairy_free',

  'unspecified',

]);

export const mealType = pgEnum('meal_type', [

  'breakfast',

  'lunch',

  'snack',

  'dinner',

]);

export type MealType = (typeof mealType.enumValues)[number];

export const sourceKind = pgEnum('source_kind', [

  'website',

  'youtube_channel',

  'social_profile',

  'single_post',

]);

export const sourceStatus = pgEnum('source_status', ['active', 'paused', 'error']);

export const recipeVisibility = pgEnum('recipe_visibility', [

  'household_private',

  'starter',

]);

export const parseMethod = pgEnum('parse_method', ['markup', 'llm', 'manual']);

export const recipeStatus = pgEnum('recipe_status', ['ready', 'needs_review']);

export const planStatus = pgEnum('plan_status', ['draft', 'accepted']);

export const planCreator = pgEnum('plan_creator', ['user', 'agent']);

export const slotMode = pgEnum('slot_mode', ['shared', 'individual']);

export const slotOutcome = pgEnum('slot_outcome', [

  'cooked',

  'skipped',

  'moved',

  'eaten_out',

]);

export const agentName = pgEnum('agent_name', [

  'coordinator',

  'setup',

  'scout',

  'planner',

  'grocery',

  'activity',

  'reviewer',

  'guardian',

]);

export const agentRunMode = pgEnum('agent_run_mode', ['chat', 'scheduled', 'event']);

export const agentRunStatus = pgEnum('agent_run_status', [

  'running',

  'completed',

  'failed',

  'blocked',

]);

export const toolPermissionLevel = pgEnum('tool_permission_level', [

  'R',

  'A',

  'P',

  'X',

]);

export const guardianStage = pgEnum('guardian_stage', [

  'input',

  'output',

  'proposal',

  'tip',

]);

export const guardianVerdict = pgEnum('guardian_verdict', [

  'pass',

  'block',

  'replace',

]);

export const approvalStatus = pgEnum('approval_status', [

  'pending',

  'approved',

  'declined',

  'expired',

]);

export const messageRole = pgEnum('message_role', [

  'user',

  'assistant',

  'tool',

  'system',

]);

export const tipOrigin = pgEnum('tip_origin', ['clinical', 'pool']);

export const prefKind = pgEnum('pref_kind', ['like', 'dislike']);

export const activityCheckinStatus = pgEnum('activity_checkin_status', [

  'done',

  'missed',

]);



/* -------------------------------------------------------------- households */



export const household = pgTable('household', {

  id: uuid('id').primaryKey().defaultRandom(),

  name: text('name').notNull(),

  tier: householdTier('tier').notNull().default('free'),

  timezone: text('timezone').notNull().default('UTC'), // IANA tz name

  agentPaused: boolean('agent_paused').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

});



/**
 * Household cooking preferences from onboarding step 2 (PRD 5.0, 7.x change_household_settings).
 * One row per household, kept apart from `household` so the PRD 10.3 columns stay as specified
 * (ADR-010). Absent row = the PRD defaults. Cascades from household (PV03).
 */
export const householdSettings = pgTable('household_settings', {
  householdId: uuid('household_id')
    .primaryKey()
    .references(() => household.id, { onDelete: 'cascade' }),
  weekdayBreakfastMinutes: integer('weekday_breakfast_minutes').notNull().default(10),
  weeknightDinnerMinutes: integer('weeknight_dinner_minutes').notNull().default(30),
  cuisines: text('cuisines').array().notNull().default(sql`'{}'::text[]`),
  budgetFeel: text('budget_feel'), // optional, later (PRD step 2); validated in the service
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Exactly one User per household (PRD: single login holder). */

export const appUser = pgTable(

  'user',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    householdId: uuid('household_id')

      .notNull()

      .references(() => household.id, { onDelete: 'cascade' }),

    name: text('name'),

    email: text('email').notNull(),

    // Auth.js expects the key `emailVerified`; DB column stays `email_verified_at`.

    emailVerified: timestamp('email_verified_at', { withTimezone: true }),

    image: text('image'),

    /** scrypt envelope (lib/auth/password.ts). Nullable: magic-link-only users have NULL. */

    passwordHash: text('password_hash'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

  },

  (t) => [

    uniqueIndex('user_email_key').on(t.email),

    uniqueIndex('user_one_per_household').on(t.householdId),

    index('user_household_idx').on(t.householdId),

  ],

);



/** Auth.js provider links (magic link = provider 'nodemailer', password = 'credentials'). */

export const accounts = pgTable(

  'account',

  {

    userId: uuid('user_id')

      .notNull()

      .references(() => appUser.id, { onDelete: 'cascade' }),

    type: text('type').notNull(),

    provider: text('provider').notNull(),

    providerAccountId: text('provider_account_id').notNull(),

    refresh_token: text('refresh_token'),

    access_token: text('access_token'),

    expires_at: integer('expires_at'),

    token_type: text('token_type'),

    scope: text('scope'),

    id_token: text('id_token'),

    session_state: text('session_state'),

  },

  (t) => [index('account_user_id_idx').on(t.userId)],

);



/** Server-side sessions: sign-out is instant and PV03 deletion removes them with the user. */

export const sessions = pgTable('session', {

  sessionToken: text('session_token').primaryKey(),

  userId: uuid('user_id')

    .notNull()

    .references(() => appUser.id, { onDelete: 'cascade' }),

  expires: timestamp('expires', { withTimezone: true }).notNull(),

});



/** Magic-link tokens (Auth.js hashes the token before storing it). */

export const verificationTokens = pgTable(

  'verification_token',

  {

    identifier: text('identifier').notNull(),

    token: text('token').notNull(),

    expires: timestamp('expires', { withTimezone: true }).notNull(),

  },

  (t) => [

    primaryKey({ columns: [t.identifier, t.token], name: 'verification_token_identifier_token_key' }),

  ],

);



/** Consent per household + data type, versioned (PV01, PRD 4 "Consent"). */

export const consent = pgTable(

  'consent',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    householdId: uuid('household_id')

      .notNull()

      .references(() => household.id, { onDelete: 'cascade' }),

    dataType: consentDataType('data_type').notNull(),

    granted: boolean('granted').notNull().default(false),

    policyVersion: text('policy_version').notNull(),

    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),

  },

  (t) => [

    // NF-P3: consent is an append-only event log, so there is deliberately no

    // unique (household, type, version) index: grant -> withdraw -> re-grant

    // under the same policy version must all be storable. Append-only is

    // enforced by trigger in migration 0003.

    index('consent_household_idx').on(t.householdId),

  ],

);



/* ---------------------------------------------------------------- members */



export const member = pgTable(

  'member',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    householdId: uuid('household_id')

      .notNull()

      .references(() => household.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),

    birthYm: text('birth_ym').notNull(), // 'YYYY-MM', never an exact DOB

    sex: memberSex('sex').notNull().default('unspecified'),

    activityLevel: activityLevel('activity_level').notNull().default('moderate'),

    dietPattern: dietPattern('diet_pattern').notNull().default('unspecified'),

    isChild: boolean('is_child').notNull().default(false), // PR01 no-weight-talk gate

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  },

  (t) => [

    index('member_household_idx').on(t.householdId),

    check(

      'member_birth_ym_format',

      sql`birth_ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,

    ),

  ],

);



/**

 * Encrypted health payload (NF-P1/NF-P2). `data_enc` is an AES-256-GCM blob:

 * base64 of iv(12) | tag(16) | ciphertext, of JSON MemberHealthData (below).

 * Key: ENCRYPTION_KEY (32-byte base64). See db/crypto.ts. No plaintext mirrors.

 */

export const memberHealth = pgTable('member_health', {

  memberId: uuid('member_id')

    .primaryKey()

    .references(() => member.id, { onDelete: 'cascade' }),

  dataEnc: text('data_enc').notNull(),

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

});



export type MemberHealthData = {

  heightCm: number | null;

  weightKg: number | null;

  conditions: string[];

  allergies: string[];

  otherAllergens: string[];

};



export const memberPref = pgTable(

  'member_pref',

  {

    memberId: uuid('member_id')

      .notNull()

      .references(() => member.id, { onDelete: 'cascade' }),

    kind: prefKind('kind').notNull(),

    item: text('item').notNull(),

    source: text('source'), // e.g. 'chat 2026-11-02', 'onboarding'

  },

  (t) => [primaryKey({ columns: [t.memberId, t.kind, t.item] }),

    index('member_pref_member_idx').on(t.memberId)],

);



/** Which member attends which meal on which weekday (0=Sun..6=Sat). */

export const memberAttendance = pgTable(

  'member_attendance',

  {

    memberId: uuid('member_id')

      .notNull()

      .references(() => member.id, { onDelete: 'cascade' }),

    mealType: mealType('meal_type').notNull(),

    weekday: smallint('weekday').notNull(),

    attending: boolean('attending').notNull(),

    packed: boolean('packed').notNull().default(false), // packed lunch vs eat-at-home

  },

  (t) => [

    primaryKey({ columns: [t.memberId, t.mealType, t.weekday] }),

    check('attendance_weekday_range', sql`weekday BETWEEN 0 AND 6`),

  ],

);



/* ---------------------------------------------------------------- content */



export const source = pgTable(

  'source',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    householdId: uuid('household_id')

      .notNull()

      .references(() => household.id, { onDelete: 'cascade' }),

    kind: sourceKind('kind').notNull(),

    platform: text('platform').notNull(), // 'website' | 'youtube' | 'instagram' | ...

    url: text('url').notNull(),

    creatorName: text('creator_name'),

    linkedWebsiteSourceId: uuid('linked_website_source_id').references(

      (): AnyPgColumn => source.id,

      { onDelete: 'set null' },

    ),

    status: sourceStatus('status').notNull().default('active'),

    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),

  },

  (t) => [index('source_household_idx').on(t.householdId)],

);



export const recipe = pgTable(

  'recipe',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    householdId: uuid('household_id').references(() => household.id, {

      onDelete: 'cascade',

    }), // null only for the starter library

    visibility: recipeVisibility('visibility').notNull().default('household_private'),

    sourceUrl: text('source_url'),

    sourceDomain: text('source_domain'),

    author: text('author'),

    title: text('title').notNull(),

    yieldServings: integer('yield').notNull().default(4),

    totalMin: integer('total_min'),

    prepMin: integer('prep_min'),

    cookMin: integer('cook_min'),

    cuisine: text('cuisine'),

    mealTypes: text('meal_types')

      .array()

      .$type<MealType[]>()

      .notNull()

      .default(sql`ARRAY[]::text[]`),

    parseMethod: parseMethod('parse_method').notNull().default('manual'),

    status: recipeStatus('status').notNull().default('ready'),
    // RE02: fields the parser was unsure of, and its per-field confidence (ADR-013).
    unsureFields: text('unsure_fields').array().notNull().default(sql`ARRAY[]::text[]`),
    parseConfidence: jsonb('parse_confidence'),

    takedownAt: timestamp('takedown_at', { withTimezone: true }), // takedown runbook

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  },

  (t) => [

    index('recipe_household_idx').on(t.householdId),

    index('recipe_source_domain_idx').on(t.sourceDomain),

    check(

      'recipe_visibility_household',

      sql`(visibility = 'starter' AND household_id IS NULL) OR (visibility <> 'starter' AND household_id IS NOT NULL)`,

    ),

  ],

);



/** The method, verbatim (copyright rule 5.3 — readable only by owning household). */

export const recipeStep = pgTable(

  'recipe_step',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    recipeId: uuid('recipe_id')

      .notNull()

      .references(() => recipe.id, { onDelete: 'cascade' }),

    position: integer('position').notNull(),

    sectionTitle: text('section_title'),

    text: text('text').notNull(),

    timerSeconds: integer('timer_seconds'),

  },

  (t) => [uniqueIndex('recipe_step_pos_key').on(t.recipeId, t.position)],

);



export const recipeIngredient = pgTable(

  'recipe_ingredient',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    recipeId: uuid('recipe_id')

      .notNull()

      .references(() => recipe.id, { onDelete: 'cascade' }),

    position: integer('position').notNull().default(0),

    rawText: text('raw_text').notNull(),

    qty: numeric('qty', { precision: 10, scale: 3 }),

    unit: text('unit'),

    food: text('food'),

    fdcId: text('fdc_id'), // USDA FoodData Central NDB number

    grams: numeric('grams', { precision: 10, scale: 2 }),

    matchConf: real('match_conf'),

    uncertainAllergenTags: text('uncertain_allergen_tags')

      .array()

      .notNull()

      .default(sql`ARRAY[]::text[]`),

  },

  (t) => [index('recipe_ingredient_recipe_idx').on(t.recipeId)],

);



export const recipeNutrients = pgTable('recipe_nutrients', {

  recipeId: uuid('recipe_id')

    .primaryKey()

    .references(() => recipe.id, { onDelete: 'cascade' }),

  perServing: jsonb('per_serving').$type<Record<string, number>>().notNull(), // {kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, ...}

  completeness: real('completeness').notNull().default(0), // 0..1 share of fields matched to FDC

});



/** RE03: local cache of USDA FoodData Central search responses, keyed by the normalised query. */
export const fdcCache = pgTable('fdc_cache', {
  query: text('query').primaryKey(),
  foods: jsonb('foods').$type<unknown[]>().notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Simple no-recipe foods (fruit, yogurt, toast) usable directly in slots. */

export const foodItem = pgTable(

  'food_item',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    householdId: uuid('household_id').references(() => household.id, {

      onDelete: 'cascade',

    }),

    fdcId: text('fdc_id'),

    name: text('name').notNull(),

    defaultPortionG: integer('default_portion_g'),

    mealTypes: text('meal_types')

      .array()

      .$type<MealType[]>()

      .notNull()

      .default(sql`ARRAY[]::text[]`),

  },

  (t) => [index('food_item_household_idx').on(t.householdId)],

);



/** Allergen confirmations are written ONLY from the UI (PR03). */

export const allergenConfirmation = pgTable(

  'allergen_confirmation',

  {

    recipeId: uuid('recipe_id')

      .notNull()

      .references(() => recipe.id, { onDelete: 'cascade' }),

    memberId: uuid('member_id')

      .notNull()

      .references(() => member.id, { onDelete: 'cascade' }),

    confirmedByUserAt: timestamp('confirmed_by_user_at', { withTimezone: true })

      .notNull()

      .defaultNow(),

  },

  (t) => [primaryKey({ columns: [t.recipeId, t.memberId] })],

);



/* ------------------------------------------------------------------- plans */



export const plan = pgTable(

  'plan',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    householdId: uuid('household_id')

      .notNull()

      .references(() => household.id, { onDelete: 'cascade' }),

    weekStart: date('week_start').notNull(), // Monday of the planned week

    seed: integer('seed').notNull(), // planner seeded RNG (reproducibility)

    prefsJson: jsonb('prefs_json').$type<Record<string, unknown>>().notNull().default({}),

    status: planStatus('status').notNull().default('draft'),

    createdBy: planCreator('created_by').notNull().default('agent'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  },

  (t) => [index('plan_household_week_idx').on(t.householdId, t.weekStart)],

);



export const planSlot = pgTable(

  'plan_slot',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    planId: uuid('plan_id')

      .notNull()

      .references(() => plan.id, { onDelete: 'cascade' }),

    date: date('date').notNull(),

    mealType: mealType('meal_type').notNull(),

    mode: slotMode('mode').notNull().default('shared'),

    sharedRecipeId: uuid('shared_recipe_id').references(() => recipe.id, {

      onDelete: 'set null',

    }),

    locked: boolean('locked').notNull().default(false),

    outcome: slotOutcome('outcome'),

  },

  (t) => [index('plan_slot_plan_idx').on(t.planId),

    index('plan_slot_date_idx').on(t.planId, t.date, t.mealType)],

);



export const slotMember = pgTable(

  'slot_member',

  {

    slotId: uuid('slot_id')

      .notNull()

      .references(() => planSlot.id, { onDelete: 'cascade' }),

    memberId: uuid('member_id')

      .notNull()

      .references(() => member.id, { onDelete: 'cascade' }),

    attending: boolean('attending').notNull().default(true),

    recipeId: uuid('recipe_id').references(() => recipe.id, { onDelete: 'set null' }),

    foodItemId: uuid('food_item_id').references(() => foodItem.id, {

      onDelete: 'set null',

    }),

    isSwap: boolean('is_swap').notNull().default(false),

    swapReason: text('swap_reason'),

  },

  (t) => [

    primaryKey({ columns: [t.slotId, t.memberId] }),

    check(

      'slot_member_one_food_ref',

      sql`(recipe_id IS NULL) OR (food_item_id IS NULL)`,

    ),

  ],

);



/** Proof that the planner ran the deterministic rule engine for a plan (rule-source culture). */

export const planRuleCheck = pgTable('plan_rule_check', {

  id: uuid('id').primaryKey().defaultRandom(),

  planId: uuid('plan_id')

    .notNull()

    .references(() => plan.id, { onDelete: 'cascade' }),

  ruleSetVersion: text('rule_set_version').notNull(),

  passedAt: timestamp('passed_at', { withTimezone: true }).notNull().defaultNow(),

  detailsJson: jsonb('details_json').$type<Record<string, unknown>>().notNull().default({}),

});



/* --------------------------------------------------------------- grocery */



export const groceryList = pgTable(

  'grocery_list',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    planId: uuid('plan_id')

      .notNull()

      .references(() => plan.id, { onDelete: 'cascade' }),

    version: integer('version').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  },

  (t) => [uniqueIndex('grocery_list_plan_version_key').on(t.planId, t.version)],

);



export const groceryItem = pgTable(

  'grocery_item',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    listId: uuid('list_id')

      .notNull()

      .references(() => groceryList.id, { onDelete: 'cascade' }),

    food: text('food').notNull(),

    qty: numeric('qty', { precision: 10, scale: 3 }),

    unit: text('unit'),

    aisle: text('aisle'),

    pantrySkip: boolean('pantry_skip').notNull().default(false),

    purchasedAt: timestamp('purchased_at', { withTimezone: true }),

  },

  (t) => [index('grocery_item_list_idx').on(t.listId)],

);



/* -------------------------------------------------------------- activity */



export const activityGoal = pgTable(

  'activity_goal',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    memberId: uuid('member_id')

      .notNull()

      .references(() => member.id, { onDelete: 'cascade' }),

    weekStart: date('week_start').notNull(),

    targetSessions: smallint('target_sessions').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  },

  (t) => [uniqueIndex('activity_goal_member_week_key').on(t.memberId, t.weekStart)],

);



export const activityCheckin = pgTable(

  'activity_checkin',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    memberId: uuid('member_id')

      .notNull()

      .references(() => member.id, { onDelete: 'cascade' }),

    weekStart: date('week_start').notNull(),

    status: activityCheckinStatus('status').notNull(),

    note: text('note'),

  },

  (t) => [uniqueIndex('activity_checkin_member_week_key').on(t.memberId, t.weekStart)],

);



/* ------------------------------------------------------------------ tips */



export const tip = pgTable('tip', {

  id: uuid('id').primaryKey().defaultRandom(),

  text: text('text').notNull(),

  sourceName: text('source_name').notNull(),

  sourceUrl: text('source_url'),

  origin: tipOrigin('origin').notNull().default('pool'),

  hiddenReason: text('hidden_reason'), // hide-only classifier (SG-G)

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

});



/* ----------------------------------------------------------------- agent */



export const agentConversation = pgTable(

  'agent_conversation',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    householdId: uuid('household_id')

      .notNull()

      .references(() => household.id, { onDelete: 'cascade' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  },

  (t) => [index('agent_conversation_household_idx').on(t.householdId)],

);



export const agentMessage = pgTable(

  'agent_message',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    conversationId: uuid('conversation_id')

      .notNull()

      .references(() => agentConversation.id, { onDelete: 'cascade' }),

    householdId: uuid('household_id')

      .notNull()

      .references(() => household.id, { onDelete: 'cascade' }),

    role: messageRole('role').notNull(),

    content: text('content').notNull(),

    guardResultsJson: jsonb('guard_results_json').$type<

      Record<string, unknown>[]

    >(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  },

  (t) => [index('agent_message_conversation_idx').on(t.conversationId)],

);



export const agentRun = pgTable(

  'agent_run',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    householdId: uuid('household_id')

      .notNull()

      .references(() => household.id, { onDelete: 'cascade' }),

    parentRunId: uuid('parent_run_id').references((): AnyPgColumn => agentRun.id, {

      onDelete: 'set null',

    }),

    agent: agentName('agent').notNull(),

    mode: agentRunMode('mode').notNull(),

    triggerRef: text('trigger_ref'),

    bundleVersion: text('bundle_version'),

    toolCalls: integer('tool_calls').notNull().default(0),

    tokens: integer('tokens').notNull().default(0),

    status: agentRunStatus('status').notNull().default('running'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),

    endedAt: timestamp('ended_at', { withTimezone: true }),

  },

  (t) => [index('agent_run_household_idx').on(t.householdId)],

);



export const agentAction = pgTable(

  'agent_action',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    runId: uuid('run_id')

      .notNull()

      .references(() => agentRun.id, { onDelete: 'cascade' }),

    agent: agentName('agent').notNull(),

    tool: text('tool').notNull(),

    level: toolPermissionLevel('level').notNull(),

    inputsSummary: jsonb('inputs_summary').$type<Record<string, unknown>>().notNull().default({}),

    resultSummary: jsonb('result_summary').$type<Record<string, unknown>>(),

    undoPayload: jsonb('undo_payload').$type<Record<string, unknown>>(),

    undoneAt: timestamp('undone_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  },

  (t) => [index('agent_action_run_idx').on(t.runId)],

);



export const guardianDecision = pgTable('guardian_decision', {

  id: uuid('id').primaryKey().defaultRandom(),

  runId: uuid('run_id')

    .notNull()

    .references(() => agentRun.id, { onDelete: 'cascade' }),

  stage: guardianStage('stage').notNull(),

  verdict: guardianVerdict('verdict').notNull(),

  reasonCode: text('reason_code'),

  fixedMessageId: uuid('fixed_message_id').references(() => agentMessage.id, {

    onDelete: 'set null',

  }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

});



/** Agent-tunable scoring weights, clamped (agents express preferences, never rules). */

export const scoringWeight = pgTable(

  'scoring_weight',

  {

    householdId: uuid('household_id')

      .notNull()

      .references(() => household.id, { onDelete: 'cascade' }),

    key: text('key').notNull(),

    value: real('value').notNull(),

    boundedMin: real('bounded_min').notNull(),

    boundedMax: real('bounded_max').notNull(),

    updatedByRun: uuid('updated_by_run').references(() => agentRun.id, {

      onDelete: 'set null',

    }),

  },

  (t) => [

    primaryKey({ columns: [t.householdId, t.key] }),

    check(

      'scoring_weight_in_bounds',

      sql`value BETWEEN bounded_min AND bounded_max`,

    ),

  ],

);



/** Approval inbox (P-level tools park proposals here until the User decides). */

export const approval = pgTable(

  'approval',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    householdId: uuid('household_id')

      .notNull()

      .references(() => household.id, { onDelete: 'cascade' }),

    runId: uuid('run_id').references(() => agentRun.id, { onDelete: 'set null' }),

    tool: text('tool').notNull(),

    proposalJson: jsonb('proposal_json').$type<Record<string, unknown>>().notNull(),

    proposalHash: text('proposal_hash').notNull(), // WP-0.5 integrity: sha256 of canonical proposal JSON

    status: approvalStatus('status').notNull().default('pending'),

    decidedAt: timestamp('decided_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  },

  (t) => [index('approval_household_status_idx').on(t.householdId, t.status)],

);



/** Structured preference memory only (7.7). Soft delete via deleted_at. */

export const memoryEntry = pgTable(

  'memory_entry',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    householdId: uuid('household_id')

      .notNull()

      .references(() => household.id, { onDelete: 'cascade' }),

    memberId: uuid('member_id').references(() => member.id, { onDelete: 'cascade' }),

    type: text('type').notNull(), // 'dislike' | 'weeknight_pattern' | ...

    value: jsonb('value').$type<Record<string, unknown> | string>().notNull(),

    source: text('source').notNull(), // e.g. 'chat 2026-11-02'

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    deletedAt: timestamp('deleted_at', { withTimezone: true }),

  },

  (t) => [index('memory_entry_household_idx').on(t.householdId)],

);



export const nudge = pgTable(

  'nudge',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    householdId: uuid('household_id')

      .notNull()

      .references(() => household.id, { onDelete: 'cascade' }),

    type: text('type').notNull(),

    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),

    sentAt: timestamp('sent_at', { withTimezone: true }),

  },

  (t) => [index('nudge_due_idx').on(t.householdId, t.scheduledFor)],

);



/** PRD: exists now, wired post-MVP. Kept empty; downstream WPs may extend via migration. */

export const clinicianTarget = pgTable(

  'clinician_target',

  {

    id: uuid('id').primaryKey().defaultRandom(),

    householdId: uuid('household_id')

      .notNull()

      .references(() => household.id, { onDelete: 'cascade' }),

    memberRef: text('member_ref'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  },

  (t) => [index('clinician_target_household_idx').on(t.householdId)],

);



/* ------------------------------------------------------------ aggregates, types */



import { sql } from 'drizzle-orm';

import { type AnyPgColumn } from 'drizzle-orm/pg-core';



export const schema = {

  household,

  householdSettings,

  appUser,

  accounts,

  sessions,

  verificationTokens,

  consent,

  member,

  memberHealth,

  memberPref,

  memberAttendance,

  source,

  recipe,

  recipeStep,

  recipeIngredient,

  recipeNutrients,

  foodItem,
  fdcCache,

  allergenConfirmation,

  plan,

  planSlot,

  slotMember,

  planRuleCheck,

  groceryList,

  groceryItem,

  activityGoal,

  activityCheckin,

  tip,

  agentConversation,

  agentMessage,

  agentRun,

  agentAction,

  guardianDecision,

  scoringWeight,

  approval,

  memoryEntry,

  nudge,

  clinicianTarget,

};



export type HouseholdRow = typeof household.$inferSelect;

export type MemberRow = typeof member.$inferSelect;

export type RecipeRow = typeof recipe.$inferSelect;

