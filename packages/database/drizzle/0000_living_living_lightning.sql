CREATE TABLE "agent_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"created_at" text NOT NULL,
	"total_tasks" integer DEFAULT 0 NOT NULL,
	"avg_score" real DEFAULT 0 NOT NULL,
	"success_rate" real DEFAULT 1 NOT NULL,
	"avg_execution_time" real DEFAULT 0 NOT NULL,
	"preferred_model" text,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weaknesses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"memory" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_version" text DEFAULT 'v1' NOT NULL,
	"versions" jsonb DEFAULT '["v1"]'::jsonb NOT NULL,
	"manifest" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_profiles_role_unique" UNIQUE("role")
);
--> statement-breakpoint
CREATE TABLE "agent_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_role" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"created_at" text NOT NULL,
	"retired_at" text,
	"reason" text DEFAULT 'initial' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blueprints" (
	"id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"display_name" text NOT NULL,
	"goal" text NOT NULL,
	"system_prompt" text NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" text DEFAULT 'v1' NOT NULL,
	"parent_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"retired_at" text,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"proposal_id" text,
	"promoted_at" text,
	"retired_at" text,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"total_executions" integer DEFAULT 0 NOT NULL,
	"avg_score" real DEFAULT 0 NOT NULL,
	"avg_duration_ms" real DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evolution_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_role" text NOT NULL,
	"from_version" text NOT NULL,
	"to_version" text NOT NULL,
	"outcome" text NOT NULL,
	"old_avg_score" real NOT NULL,
	"new_avg_score" real NOT NULL,
	"triggered_at" text NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"task_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_role" text NOT NULL,
	"blueprint_id" text,
	"blueprint_version" text,
	"graph_id" text,
	"model_assignment" jsonb,
	"artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review" jsonb,
	"user_feedback" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" numeric,
	"status" text DEFAULT 'completed' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "failure_insights" (
	"id" text PRIMARY KEY NOT NULL,
	"pattern" text NOT NULL,
	"frequency" integer NOT NULL,
	"agent_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"providers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"avg_score" real NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_seen" text NOT NULL,
	"last_seen" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governance_config" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"max_agents" integer NOT NULL,
	"max_capabilities" integer NOT NULL,
	"max_depth" integer NOT NULL,
	"require_review_for_birth" boolean DEFAULT true NOT NULL,
	"min_usage_for_birth" integer DEFAULT 0 NOT NULL,
	"hitl_risk_threshold" real DEFAULT 0.4 NOT NULL,
	"hitl_always_for_actions" jsonb DEFAULT '["retire"]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaderboard_insights" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"generated_at" text NOT NULL,
	"total_executions" integer NOT NULL,
	"worst_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"worst_models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"task_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"agent_id" text NOT NULL,
	"agent_role" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"execution_time" numeric NOT NULL,
	"token_input" integer NOT NULL,
	"token_output" integer NOT NULL,
	"review_score" numeric,
	"user_accepted" boolean,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"timestamp" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"type" text NOT NULL,
	"subject" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_proposals" (
	"proposal_id" text PRIMARY KEY NOT NULL,
	"proposal" jsonb NOT NULL,
	"simulation" jsonb NOT NULL,
	"score" jsonb NOT NULL,
	"snapshot_id" text,
	"status" text DEFAULT 'pending_human' NOT NULL,
	"requested_at" text NOT NULL,
	"resolved_at" text,
	"resolved_by" text,
	"resolution_reason" text
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"jti" text NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_jti_unique" UNIQUE("jti")
);
--> statement-breakpoint
CREATE TABLE "team_graphs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_request" text NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"layers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_evolution_traces" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"proposal_type" text NOT NULL,
	"subject" text NOT NULL,
	"snapshot_id" text,
	"simulated_scores" jsonb NOT NULL,
	"governance_verdict" jsonb NOT NULL,
	"rollout_status" text NOT NULL,
	"approved" boolean NOT NULL,
	"recorded_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_execution_traces" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"task_id" text NOT NULL,
	"user_prompt" text NOT NULL,
	"assigned_team_graph" jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"started_at" text NOT NULL,
	"completed_at" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspace_artifacts" (
	"workspace_id" text NOT NULL,
	"filename" text NOT NULL,
	"content" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"user_request" text NOT NULL,
	"status" text NOT NULL,
	"plan" jsonb,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_events" ADD CONSTRAINT "org_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_artifacts" ADD CONSTRAINT "workspace_artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_artifacts_workspace_filename_uq" ON "workspace_artifacts" USING btree ("workspace_id","filename");