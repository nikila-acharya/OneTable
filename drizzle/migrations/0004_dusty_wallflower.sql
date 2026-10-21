CREATE TABLE "household_settings" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"weekday_breakfast_minutes" integer DEFAULT 10 NOT NULL,
	"weeknight_dinner_minutes" integer DEFAULT 30 NOT NULL,
	"cuisines" text[] DEFAULT '{}'::text[] NOT NULL,
	"budget_feel" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_settings" ADD CONSTRAINT "household_settings_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;