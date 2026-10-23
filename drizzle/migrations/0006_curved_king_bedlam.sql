CREATE TABLE "fdc_cache" (
	"query" text PRIMARY KEY NOT NULL,
	"foods" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
