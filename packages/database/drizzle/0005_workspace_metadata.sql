ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}' NOT NULL;
