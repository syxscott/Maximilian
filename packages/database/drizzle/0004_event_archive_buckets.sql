ALTER TABLE executions ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE org_events ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS executions_archive (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  blueprint_id TEXT,
  blueprint_version TEXT,
  graph_id TEXT,
  model_assignment JSONB,
  artifacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  review JSONB,
  user_feedback JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms NUMERIC,
  status TEXT NOT NULL DEFAULT 'completed',
  error TEXT,
  archived_at TIMESTAMPTZ NOT NULL,
  archive_bucket TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS org_events_archive (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ NOT NULL,
  archive_bucket TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_executions_workspace_hot ON executions(workspace_id, archived_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_executions_role_hot ON executions(agent_role, archived_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_executions_blueprint_hot ON executions(blueprint_id, archived_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_org_events_subject_hot ON org_events(subject, archived_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_org_events_type_hot ON org_events(type, archived_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_executions_archive_workspace ON executions_archive(workspace_id, archive_bucket);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_executions_archive_role ON executions_archive(agent_role, archive_bucket);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_executions_archive_blueprint ON executions_archive(blueprint_id, archive_bucket);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_org_events_archive_subject ON org_events_archive(subject, archive_bucket);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_org_events_archive_type ON org_events_archive(type, archive_bucket);
