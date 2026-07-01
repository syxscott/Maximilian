CREATE TABLE "provider_configs" (
	"provider_id" text PRIMARY KEY NOT NULL,
	"default_model" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"default_provider" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "metrics" ADD COLUMN "cache_read_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "metrics" ADD COLUMN "cache_creation_tokens" integer DEFAULT 0 NOT NULL;