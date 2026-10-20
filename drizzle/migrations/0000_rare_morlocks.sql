CREATE TYPE "public"."activity_checkin_status" AS ENUM('done', 'missed');--> statement-breakpoint
CREATE TYPE "public"."activity_level" AS ENUM('sedentary', 'light', 'moderate', 'high', 'athlete');--> statement-breakpoint
CREATE TYPE "public"."agent_name" AS ENUM('coordinator', 'setup', 'scout', 'planner', 'grocery', 'activity', 'reviewer', 'guardian');--> statement-breakpoint
CREATE TYPE "public"."agent_run_mode" AS ENUM('chat', 'scheduled', 'event');--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'completed', 'failed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."consent_data_type" AS ENUM('health_conditions', 'allergies', 'body_measurements', 'activity_data', 'agent_processing');--> statement-breakpoint
CREATE TYPE "public"."diet_pattern" AS ENUM('omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'kosher', 'gluten_free', 'dairy_free', 'unspecified');--> statement-breakpoint
CREATE TYPE "public"."guardian_stage" AS ENUM('input', 'output', 'proposal', 'tip');--> statement-breakpoint
CREATE TYPE "public"."guardian_verdict" AS ENUM('pass', 'block', 'replace');--> statement-breakpoint
CREATE TYPE "public"."household_tier" AS ENUM('free', 'household');--> statement-breakpoint
CREATE TYPE "public"."meal_type" AS ENUM('breakfast', 'lunch', 'snack', 'dinner');--> statement-breakpoint
CREATE TYPE "public"."member_sex" AS ENUM('male', 'female', 'other', 'unspecified');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'tool', 'system');--> statement-breakpoint
CREATE TYPE "public"."parse_method" AS ENUM('markup', 'llm', 'manual');--> statement-breakpoint
CREATE TYPE "public"."plan_creator" AS ENUM('user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'accepted');--> statement-breakpoint
CREATE TYPE "public"."pref_kind" AS ENUM('like', 'dislike');--> statement-breakpoint
CREATE TYPE "public"."recipe_status" AS ENUM('ready', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."recipe_visibility" AS ENUM('household_private', 'starter');--> statement-breakpoint
CREATE TYPE "public"."slot_mode" AS ENUM('shared', 'individual');--> statement-breakpoint
CREATE TYPE "public"."slot_outcome" AS ENUM('cooked', 'skipped', 'moved', 'eaten_out');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('website', 'youtube_channel', 'social_profile', 'single_post');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('active', 'paused', 'error');--> statement-breakpoint
CREATE TYPE "public"."tip_origin" AS ENUM('clinical', 'pool');--> statement-breakpoint
CREATE TYPE "public"."tool_permission_level" AS ENUM('R', 'A', 'P', 'X');--> statement-breakpoint
CREATE TABLE "activity_checkin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" "activity_checkin_status" NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "activity_goal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"target_sessions" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"agent" "agent_name" NOT NULL,
	"tool" text NOT NULL,
	"level" "tool_permission_level" NOT NULL,
	"inputs_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_summary" jsonb,
	"undo_payload" jsonb,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"guard_results_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"parent_run_id" uuid,
	"agent" "agent_name" NOT NULL,
	"mode" "agent_run_mode" NOT NULL,
	"trigger_ref" text,
	"bundle_version" text,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"status" "agent_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "allergen_confirmation" (
	"recipe_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"confirmed_by_user_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allergen_confirmation_recipe_id_member_id_pk" PRIMARY KEY("recipe_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"run_id" uuid,
	"tool" text NOT NULL,
	"proposal_json" jsonb NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinician_target" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"data_type" "consent_data_type" NOT NULL,
	"granted" boolean DEFAULT false NOT NULL,
	"policy_version" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"fdc_id" text,
	"name" text NOT NULL,
	"default_portion_g" integer,
	"meal_types" text[] DEFAULT ARRAY[]::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grocery_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"food" text NOT NULL,
	"qty" numeric(10, 3),
	"unit" text,
	"aisle" text,
	"pantry_skip" boolean DEFAULT false NOT NULL,
	"purchased_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "grocery_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardian_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage" "guardian_stage" NOT NULL,
	"verdict" "guardian_verdict" NOT NULL,
	"reason_code" text,
	"fixed_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tier" "household_tier" DEFAULT 'free' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"agent_paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"birth_ym" text NOT NULL,
	"sex" "member_sex" DEFAULT 'unspecified' NOT NULL,
	"activity_level" "activity_level" DEFAULT 'moderate' NOT NULL,
	"diet_pattern" "diet_pattern" DEFAULT 'unspecified' NOT NULL,
	"is_child" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_birth_ym_format" CHECK (birth_ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "member_attendance" (
	"member_id" uuid NOT NULL,
	"meal_type" "meal_type" NOT NULL,
	"weekday" smallint NOT NULL,
	"attending" boolean NOT NULL,
	"packed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "member_attendance_member_id_meal_type_weekday_pk" PRIMARY KEY("member_id","meal_type","weekday"),
	CONSTRAINT "attendance_weekday_range" CHECK (weekday BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "member_health" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"data_enc" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_pref" (
	"member_id" uuid NOT NULL,
	"kind" "pref_kind" NOT NULL,
	"item" text NOT NULL,
	"source" text,
	CONSTRAINT "member_pref_member_id_kind_item_pk" PRIMARY KEY("member_id","kind","item")
);
--> statement-breakpoint
CREATE TABLE "memory_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid,
	"type" text NOT NULL,
	"value" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "nudge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"type" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"seed" integer NOT NULL,
	"prefs_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"created_by" "plan_creator" DEFAULT 'agent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_rule_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"rule_set_version" text NOT NULL,
	"passed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"details_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_slot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"date" date NOT NULL,
	"meal_type" "meal_type" NOT NULL,
	"mode" "slot_mode" DEFAULT 'shared' NOT NULL,
	"shared_recipe_id" uuid,
	"locked" boolean DEFAULT false NOT NULL,
	"outcome" "slot_outcome"
);
--> statement-breakpoint
CREATE TABLE "recipe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"visibility" "recipe_visibility" DEFAULT 'household_private' NOT NULL,
	"source_url" text,
	"source_domain" text,
	"author" text,
	"title" text NOT NULL,
	"yield" integer DEFAULT 4 NOT NULL,
	"total_min" integer,
	"prep_min" integer,
	"cook_min" integer,
	"cuisine" text,
	"meal_types" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"parse_method" "parse_method" DEFAULT 'manual' NOT NULL,
	"status" "recipe_status" DEFAULT 'ready' NOT NULL,
	"takedown_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_visibility_household" CHECK ((visibility = 'starter' AND household_id IS NULL) OR (visibility <> 'starter' AND household_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"raw_text" text NOT NULL,
	"qty" numeric(10, 3),
	"unit" text,
	"food" text,
	"fdc_id" text,
	"grams" numeric(10, 2),
	"match_conf" real,
	"uncertain_allergen_tags" text[] DEFAULT ARRAY[]::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_nutrients" (
	"recipe_id" uuid PRIMARY KEY NOT NULL,
	"per_serving" jsonb NOT NULL,
	"completeness" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"section_title" text,
	"text" text NOT NULL,
	"timer_seconds" integer
);
--> statement-breakpoint
CREATE TABLE "scoring_weight" (
	"household_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" real NOT NULL,
	"bounded_min" real NOT NULL,
	"bounded_max" real NOT NULL,
	"updated_by_run" uuid,
	CONSTRAINT "scoring_weight_household_id_key_pk" PRIMARY KEY("household_id","key"),
	CONSTRAINT "scoring_weight_in_bounds" CHECK (value BETWEEN bounded_min AND bounded_max)
);
--> statement-breakpoint
CREATE TABLE "slot_member" (
	"slot_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"attending" boolean DEFAULT true NOT NULL,
	"recipe_id" uuid,
	"food_item_id" uuid,
	"is_swap" boolean DEFAULT false NOT NULL,
	"swap_reason" text,
	CONSTRAINT "slot_member_slot_id_member_id_pk" PRIMARY KEY("slot_id","member_id"),
	CONSTRAINT "slot_member_one_food_ref" CHECK ((recipe_id IS NULL) OR (food_item_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" "source_kind" NOT NULL,
	"platform" text NOT NULL,
	"url" text NOT NULL,
	"creator_name" text,
	"linked_website_source_id" uuid,
	"status" "source_status" DEFAULT 'active' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text,
	"origin" "tip_origin" DEFAULT 'pool' NOT NULL,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_checkin" ADD CONSTRAINT "activity_checkin_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_goal" ADD CONSTRAINT "activity_goal_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_action" ADD CONSTRAINT "agent_action_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation" ADD CONSTRAINT "agent_conversation_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_message" ADD CONSTRAINT "agent_message_conversation_id_agent_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_message" ADD CONSTRAINT "agent_message_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_parent_run_id_agent_run_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allergen_confirmation" ADD CONSTRAINT "allergen_confirmation_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allergen_confirmation" ADD CONSTRAINT "allergen_confirmation_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinician_target" ADD CONSTRAINT "clinician_target_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_item" ADD CONSTRAINT "food_item_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_item" ADD CONSTRAINT "grocery_item_list_id_grocery_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."grocery_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_list" ADD CONSTRAINT "grocery_list_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_decision" ADD CONSTRAINT "guardian_decision_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_decision" ADD CONSTRAINT "guardian_decision_fixed_message_id_agent_message_id_fk" FOREIGN KEY ("fixed_message_id") REFERENCES "public"."agent_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_attendance" ADD CONSTRAINT "member_attendance_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_health" ADD CONSTRAINT "member_health_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_pref" ADD CONSTRAINT "member_pref_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entry" ADD CONSTRAINT "memory_entry_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entry" ADD CONSTRAINT "memory_entry_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nudge" ADD CONSTRAINT "nudge_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_rule_check" ADD CONSTRAINT "plan_rule_check_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_slot" ADD CONSTRAINT "plan_slot_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_slot" ADD CONSTRAINT "plan_slot_shared_recipe_id_recipe_id_fk" FOREIGN KEY ("shared_recipe_id") REFERENCES "public"."recipe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_nutrients" ADD CONSTRAINT "recipe_nutrients_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_step" ADD CONSTRAINT "recipe_step_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_weight" ADD CONSTRAINT "scoring_weight_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_weight" ADD CONSTRAINT "scoring_weight_updated_by_run_agent_run_id_fk" FOREIGN KEY ("updated_by_run") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_member" ADD CONSTRAINT "slot_member_slot_id_plan_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."plan_slot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_member" ADD CONSTRAINT "slot_member_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_member" ADD CONSTRAINT "slot_member_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_member" ADD CONSTRAINT "slot_member_food_item_id_food_item_id_fk" FOREIGN KEY ("food_item_id") REFERENCES "public"."food_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "source_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "source_linked_website_source_id_source_id_fk" FOREIGN KEY ("linked_website_source_id") REFERENCES "public"."source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_checkin_member_week_key" ON "activity_checkin" USING btree ("member_id","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_goal_member_week_key" ON "activity_goal" USING btree ("member_id","week_start");--> statement-breakpoint
CREATE INDEX "agent_action_run_idx" ON "agent_action" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_conversation_household_idx" ON "agent_conversation" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "agent_message_conversation_idx" ON "agent_message" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "agent_run_household_idx" ON "agent_run" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_key" ON "user" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_one_per_household" ON "user" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "user_household_idx" ON "user" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "approval_household_status_idx" ON "approval" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "clinician_target_household_idx" ON "clinician_target" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_household_type_version_key" ON "consent" USING btree ("household_id","data_type","policy_version");--> statement-breakpoint
CREATE INDEX "consent_household_idx" ON "consent" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "food_item_household_idx" ON "food_item" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "grocery_item_list_idx" ON "grocery_item" USING btree ("list_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grocery_list_plan_version_key" ON "grocery_list" USING btree ("plan_id","version");--> statement-breakpoint
CREATE INDEX "member_household_idx" ON "member" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "member_pref_member_idx" ON "member_pref" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "memory_entry_household_idx" ON "memory_entry" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "nudge_due_idx" ON "nudge" USING btree ("household_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "plan_household_week_idx" ON "plan" USING btree ("household_id","week_start");--> statement-breakpoint
CREATE INDEX "plan_slot_plan_idx" ON "plan_slot" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "plan_slot_date_idx" ON "plan_slot" USING btree ("plan_id","date","meal_type");--> statement-breakpoint
CREATE INDEX "recipe_household_idx" ON "recipe" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "recipe_source_domain_idx" ON "recipe" USING btree ("source_domain");--> statement-breakpoint
CREATE INDEX "recipe_ingredient_recipe_idx" ON "recipe_ingredient" USING btree ("recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_step_pos_key" ON "recipe_step" USING btree ("recipe_id","position");--> statement-breakpoint
CREATE INDEX "source_household_idx" ON "source" USING btree ("household_id");