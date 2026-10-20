ALTER TABLE "agent_run" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "approval" ADD COLUMN "proposal_hash" text NOT NULL;