ALTER TABLE "recipe" ADD COLUMN "unsure_fields" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "parse_confidence" jsonb;