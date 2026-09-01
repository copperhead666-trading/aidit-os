-- Paperclip database backup
-- Created: 2026-08-28T05:16:48.808Z

BEGIN;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
SET LOCAL session_replication_role = replica;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
SET LOCAL client_min_messages = warning;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Schemas
CREATE SCHEMA IF NOT EXISTS "drizzle";
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Extensions
CREATE EXTENSION IF NOT EXISTS "fuzzystrmatch" WITH SCHEMA "public";
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Sequences
DROP SEQUENCE IF EXISTS "drizzle"."__drizzle_migrations_id_seq" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE SEQUENCE "drizzle"."__drizzle_migrations_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 NO CYCLE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
DROP SEQUENCE IF EXISTS "public"."heartbeat_run_events_id_seq" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE SEQUENCE "public"."heartbeat_run_events_id_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 NO CYCLE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: drizzle.__drizzle_migrations
DROP TABLE IF EXISTS "drizzle"."__drizzle_migrations" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "drizzle"."__drizzle_migrations" (
  "id" integer DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass) NOT NULL,
  "hash" text NOT NULL,
  "created_at" bigint,
  CONSTRAINT "__drizzle_migrations_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.account
DROP TABLE IF EXISTS "public"."account" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."account" (
  "id" text NOT NULL,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamp with time zone,
  "refresh_token_expires_at" timestamp with time zone,
  "scope" text,
  "password" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.activity_log
DROP TABLE IF EXISTS "public"."activity_log" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."activity_log" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "actor_type" text DEFAULT 'system'::text NOT NULL,
  "actor_id" text NOT NULL,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "agent_id" uuid,
  "details" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "run_id" uuid,
  "responsible_user_id" text,
  CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.agent_api_keys
DROP TABLE IF EXISTS "public"."agent_api_keys" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."agent_api_keys" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "key_hash" text NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "scope_config" jsonb,
  "responsible_user_id" text,
  CONSTRAINT "agent_api_keys_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.agent_config_revisions
DROP TABLE IF EXISTS "public"."agent_config_revisions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."agent_config_revisions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "source" text DEFAULT 'patch'::text NOT NULL,
  "rolled_back_from_revision_id" uuid,
  "changed_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "before_config" jsonb NOT NULL,
  "after_config" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_config_revisions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.agent_memberships
DROP TABLE IF EXISTS "public"."agent_memberships" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."agent_memberships" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "state" text DEFAULT 'joined'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "starred_at" timestamp with time zone,
  CONSTRAINT "agent_memberships_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.agent_runtime_state
DROP TABLE IF EXISTS "public"."agent_runtime_state" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."agent_runtime_state" (
  "agent_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "adapter_type" text NOT NULL,
  "session_id" text,
  "state_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_run_id" uuid,
  "last_run_status" text,
  "total_input_tokens" bigint DEFAULT 0 NOT NULL,
  "total_output_tokens" bigint DEFAULT 0 NOT NULL,
  "total_cached_input_tokens" bigint DEFAULT 0 NOT NULL,
  "total_cost_cents" bigint DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_runtime_state_pkey" PRIMARY KEY ("agent_id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.agent_task_sessions
DROP TABLE IF EXISTS "public"."agent_task_sessions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."agent_task_sessions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "adapter_type" text NOT NULL,
  "task_key" text NOT NULL,
  "session_params_json" jsonb,
  "session_display_id" text,
  "last_run_id" uuid,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_task_sessions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.agent_wakeup_requests
DROP TABLE IF EXISTS "public"."agent_wakeup_requests" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."agent_wakeup_requests" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "source" text NOT NULL,
  "trigger_detail" text,
  "reason" text,
  "payload" jsonb,
  "status" text DEFAULT 'queued'::text NOT NULL,
  "coalesced_count" integer DEFAULT 0 NOT NULL,
  "requested_by_actor_type" text,
  "requested_by_actor_id" text,
  "idempotency_key" text,
  "run_id" uuid,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "claimed_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_wakeup_requests_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.agents
DROP TABLE IF EXISTS "public"."agents" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."agents" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "role" text DEFAULT 'general'::text NOT NULL,
  "title" text,
  "status" text DEFAULT 'idle'::text NOT NULL,
  "reports_to" uuid,
  "capabilities" text,
  "adapter_type" text DEFAULT 'process'::text NOT NULL,
  "adapter_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "budget_monthly_cents" integer DEFAULT 0 NOT NULL,
  "spent_monthly_cents" integer DEFAULT 0 NOT NULL,
  "last_heartbeat_at" timestamp with time zone,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "runtime_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "icon" text,
  "pause_reason" text,
  "paused_at" timestamp with time zone,
  "default_environment_id" uuid,
  "error_reason" text,
  CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.approval_comments
DROP TABLE IF EXISTS "public"."approval_comments" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."approval_comments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "approval_id" uuid NOT NULL,
  "author_agent_id" uuid,
  "author_user_id" text,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "approval_comments_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.approvals
DROP TABLE IF EXISTS "public"."approvals" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."approvals" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "type" text NOT NULL,
  "requested_by_agent_id" uuid,
  "requested_by_user_id" text,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "payload" jsonb NOT NULL,
  "decision_note" text,
  "decided_by_user_id" text,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.assets
DROP TABLE IF EXISTS "public"."assets" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."assets" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "object_key" text NOT NULL,
  "content_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "sha256" text NOT NULL,
  "original_filename" text,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.board_api_keys
DROP TABLE IF EXISTS "public"."board_api_keys" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."board_api_keys" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "key_hash" text NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "board_api_keys_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.budget_incidents
DROP TABLE IF EXISTS "public"."budget_incidents" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."budget_incidents" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "policy_id" uuid NOT NULL,
  "scope_type" text NOT NULL,
  "scope_id" uuid NOT NULL,
  "metric" text NOT NULL,
  "window_kind" text NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "window_end" timestamp with time zone NOT NULL,
  "threshold_type" text NOT NULL,
  "amount_limit" integer NOT NULL,
  "amount_observed" integer NOT NULL,
  "status" text DEFAULT 'open'::text NOT NULL,
  "approval_id" uuid,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "budget_incidents_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.budget_policies
DROP TABLE IF EXISTS "public"."budget_policies" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."budget_policies" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "scope_type" text NOT NULL,
  "scope_id" uuid NOT NULL,
  "metric" text DEFAULT 'billed_cents'::text NOT NULL,
  "window_kind" text NOT NULL,
  "amount" integer DEFAULT 0 NOT NULL,
  "warn_percent" integer DEFAULT 80 NOT NULL,
  "hard_stop_enabled" boolean DEFAULT true NOT NULL,
  "notify_enabled" boolean DEFAULT true NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" text,
  "updated_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "budget_policies_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.built_in_managed_resources
DROP TABLE IF EXISTS "public"."built_in_managed_resources" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."built_in_managed_resources" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "bundle_key" text NOT NULL,
  "resource_kind" text NOT NULL,
  "resource_key" text NOT NULL,
  "resource_id" uuid NOT NULL,
  "stock_version" text NOT NULL,
  "stock_hash" text NOT NULL,
  "defaults_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "built_in_managed_resources_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.case_attachments
DROP TABLE IF EXISTS "public"."case_attachments" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."case_attachments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "case_attachments_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.case_documents
DROP TABLE IF EXISTS "public"."case_documents" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."case_documents" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "case_documents_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.case_events
DROP TABLE IF EXISTS "public"."case_events" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."case_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "actor_type" text NOT NULL,
  "actor_user_id" text,
  "actor_agent_id" uuid,
  "run_id" uuid,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "case_events_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.case_issue_links
DROP TABLE IF EXISTS "public"."case_issue_links" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."case_issue_links" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "role" text NOT NULL,
  "created_by_run_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "case_issue_links_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.case_labels
DROP TABLE IF EXISTS "public"."case_labels" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."case_labels" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "label_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "case_labels_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.cases
DROP TABLE IF EXISTS "public"."cases" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."cases" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "project_id" uuid,
  "case_number" integer NOT NULL,
  "identifier" text NOT NULL,
  "case_type" text NOT NULL,
  "key" text,
  "title" text NOT NULL,
  "summary" text,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "parent_case_id" uuid,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.cli_auth_challenges
DROP TABLE IF EXISTS "public"."cli_auth_challenges" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."cli_auth_challenges" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "secret_hash" text NOT NULL,
  "command" text NOT NULL,
  "client_name" text,
  "requested_access" text DEFAULT 'board'::text NOT NULL,
  "requested_company_id" uuid,
  "pending_key_hash" text NOT NULL,
  "pending_key_name" text NOT NULL,
  "approved_by_user_id" text,
  "board_api_key_id" uuid,
  "approved_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cli_auth_challenges_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.companies
DROP TABLE IF EXISTS "public"."companies" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."companies" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'active'::text NOT NULL,
  "budget_monthly_cents" integer DEFAULT 0 NOT NULL,
  "spent_monthly_cents" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "issue_prefix" text DEFAULT 'PAP'::text NOT NULL,
  "issue_counter" integer DEFAULT 0 NOT NULL,
  "require_board_approval_for_new_agents" boolean DEFAULT false NOT NULL,
  "brand_color" text,
  "pause_reason" text,
  "paused_at" timestamp with time zone,
  "feedback_data_sharing_enabled" boolean DEFAULT false NOT NULL,
  "feedback_data_sharing_consent_at" timestamp with time zone,
  "feedback_data_sharing_consent_by_user_id" text,
  "feedback_data_sharing_terms_version" text,
  "attachment_max_bytes" integer DEFAULT 10485760 NOT NULL,
  "default_responsible_user_id" text,
  "interaction_resolver_governance" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.company_logos
DROP TABLE IF EXISTS "public"."company_logos" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."company_logos" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_logos_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.company_memberships
DROP TABLE IF EXISTS "public"."company_memberships" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."company_memberships" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "principal_type" text NOT NULL,
  "principal_id" text NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "membership_role" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_memberships_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.company_secret_bindings
DROP TABLE IF EXISTS "public"."company_secret_bindings" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."company_secret_bindings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "secret_id" uuid NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "config_path" text NOT NULL,
  "version_selector" text DEFAULT 'latest'::text NOT NULL,
  "required" boolean DEFAULT true NOT NULL,
  "label" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "projection_class" text DEFAULT 'unclassified'::text NOT NULL,
  "projection_allowlist_key" text,
  CONSTRAINT "company_secret_bindings_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.company_secret_proposals
DROP TABLE IF EXISTS "public"."company_secret_proposals" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."company_secret_proposals" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "proposed_name" text,
  "proposed_key" text,
  "proposed_description" text,
  "justification" text NOT NULL,
  "value_ciphertext" jsonb,
  "value_fingerprint_sha256" text,
  "value_length" integer,
  "secret_id" uuid,
  "secret_proposal_id" uuid,
  "target_type" text,
  "target_id" uuid,
  "config_path" text,
  "projection_class" text DEFAULT 'unclassified'::text NOT NULL,
  "binding_target_policy_snapshot" text,
  "proposer_ancestor_ids_snapshot" jsonb,
  "target_ancestor_ids_snapshot" jsonb,
  "proposed_by_agent_id" uuid NOT NULL,
  "origin_issue_id" uuid,
  "origin_run_id" uuid NOT NULL,
  "resolved_by_user_id" text,
  "resolved_at" timestamp with time zone,
  "resolution_reason" text,
  "created_secret_id" uuid,
  "applied_binding_config_path" text,
  "ciphertext_scrubbed_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_secret_proposals_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.company_secret_provider_configs
DROP TABLE IF EXISTS "public"."company_secret_provider_configs" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."company_secret_provider_configs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "display_name" text NOT NULL,
  "status" text DEFAULT 'ready'::text NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "health_status" text,
  "health_checked_at" timestamp with time zone,
  "health_message" text,
  "health_details" jsonb,
  "disabled_at" timestamp with time zone,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_secret_provider_configs_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.company_secret_versions
DROP TABLE IF EXISTS "public"."company_secret_versions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."company_secret_versions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "secret_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "material" jsonb NOT NULL,
  "value_sha256" text NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  "provider_version_ref" text,
  "status" text DEFAULT 'current'::text NOT NULL,
  "fingerprint_sha256" text NOT NULL,
  "rotation_job_id" text,
  CONSTRAINT "company_secret_versions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.company_secrets
DROP TABLE IF EXISTS "public"."company_secrets" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."company_secrets" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "provider" text DEFAULT 'local_encrypted'::text NOT NULL,
  "external_ref" text,
  "latest_version" integer DEFAULT 1 NOT NULL,
  "description" text,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "key" text NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "managed_mode" text DEFAULT 'paperclip_managed'::text NOT NULL,
  "provider_config_id" uuid,
  "provider_metadata" jsonb,
  "last_resolved_at" timestamp with time zone,
  "last_rotated_at" timestamp with time zone,
  "deleted_at" timestamp with time zone,
  "scope" text DEFAULT 'company'::text NOT NULL,
  "owner_user_id" text,
  "user_secret_definition_id" uuid,
  CONSTRAINT "company_secrets_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.company_skill_comments
DROP TABLE IF EXISTS "public"."company_skill_comments" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."company_skill_comments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "company_skill_id" uuid NOT NULL,
  "parent_comment_id" uuid,
  "author_agent_id" uuid,
  "author_user_id" text,
  "body" text NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_skill_comments_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.company_skill_policies
DROP TABLE IF EXISTS "public"."company_skill_policies" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."company_skill_policies" (
  "company_id" uuid NOT NULL,
  "schema_version" integer DEFAULT 1 NOT NULL,
  "revision" integer NOT NULL,
  "default_effect" text NOT NULL,
  "rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_skill_policies_pkey" PRIMARY KEY ("company_id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.company_skill_stars
DROP TABLE IF EXISTS "public"."company_skill_stars" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."company_skill_stars" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "company_skill_id" uuid NOT NULL,
  "agent_id" uuid,
  "user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_skill_stars_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.company_skill_test_inputs
DROP TABLE IF EXISTS "public"."company_skill_test_inputs" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."company_skill_test_inputs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "skill_id" uuid NOT NULL,
  "name" text NOT NULL,
  "content" text NOT NULL,
  "created_by" text,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_skill_test_inputs_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.company_skill_test_run_templates
DROP TABLE IF EXISTS "public"."company_skill_test_run_templates" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."company_skill_test_run_templates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "body" text NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "updated_by_agent_id" uuid,
  "updated_by_user_id" text,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_skill_test_run_templates_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.company_skill_test_runs
DROP TABLE IF EXISTS "public"."company_skill_test_runs" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."company_skill_test_runs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "skill_id" uuid NOT NULL,
  "input_id" uuid,
  "input_snapshot" text NOT NULL,
  "skill_version_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "agent_config_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "issue_id" uuid NOT NULL,
  "status" text DEFAULT 'queued'::text NOT NULL,
  "output_document_key" text DEFAULT 'output'::text NOT NULL,
  "output_snapshot" text DEFAULT ''::text NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "superseded_at" timestamp with time zone,
  "harness_issue_expires_at" timestamp with time zone,
  "harness_issue_deleted_at" timestamp with time zone,
  "template_id" text,
  "template_name" text,
  "template_body" text,
  "rendered_template_body" text,
  "harness_issue_description" text DEFAULT ''::text NOT NULL,
  CONSTRAINT "company_skill_test_runs_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.company_skill_versions
DROP TABLE IF EXISTS "public"."company_skill_versions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."company_skill_versions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "company_skill_id" uuid NOT NULL,
  "revision_number" integer NOT NULL,
  "label" text,
  "file_inventory" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "author_agent_id" uuid,
  "author_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "release_id" text,
  "release_name" text,
  "released_at" timestamp with time zone,
  CONSTRAINT "company_skill_versions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.company_skills
DROP TABLE IF EXISTS "public"."company_skills" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."company_skills" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "key" text NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "markdown" text NOT NULL,
  "source_type" text DEFAULT 'local_path'::text NOT NULL,
  "source_locator" text,
  "source_ref" text,
  "trust_level" text DEFAULT 'markdown_only'::text NOT NULL,
  "compatibility" text DEFAULT 'compatible'::text NOT NULL,
  "file_inventory" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "icon_url" text,
  "color" text,
  "tagline" text,
  "author_name" text,
  "homepage_url" text,
  "categories" text[] DEFAULT '{}'::text[] NOT NULL,
  "sharing_scope" text DEFAULT 'company'::text NOT NULL,
  "public_share_token" text,
  "forked_from_skill_id" uuid,
  "forked_from_company_id" uuid,
  "star_count" integer DEFAULT 0 NOT NULL,
  "install_count" integer DEFAULT 0 NOT NULL,
  "fork_count" integer DEFAULT 0 NOT NULL,
  "current_version_id" uuid,
  "folder_id" uuid,
  CONSTRAINT "company_skills_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.company_user_sidebar_preferences
DROP TABLE IF EXISTS "public"."company_user_sidebar_preferences" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."company_user_sidebar_preferences" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "project_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_user_sidebar_preferences_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.connection_grants
DROP TABLE IF EXISTS "public"."connection_grants" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."connection_grants" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "connection_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "subject_user_id" text,
  "provider_tenant" jsonb,
  "credential_secret_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "revoked_at" timestamp with time zone,
  "revoked_by_agent_id" uuid,
  "revoked_by_user_id" text,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "connection_grants_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.connection_token_issuances
DROP TABLE IF EXISTS "public"."connection_token_issuances" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."connection_token_issuances" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "application_id" uuid,
  "connection_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "run_id" uuid,
  "issue_id" uuid,
  "project_id" uuid,
  "responsible_user_id" text,
  "path" text NOT NULL,
  "requested_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "issued_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "ttl_seconds" integer,
  "expires_at" timestamp with time zone,
  "token_hash" text,
  "outcome" text NOT NULL,
  "error_code" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "connection_token_issuances_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.cost_events
DROP TABLE IF EXISTS "public"."cost_events" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."cost_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "issue_id" uuid,
  "project_id" uuid,
  "goal_id" uuid,
  "billing_code" text,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "cost_cents" integer NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "heartbeat_run_id" uuid,
  "biller" text DEFAULT 'unknown'::text NOT NULL,
  "billing_type" text DEFAULT 'unknown'::text NOT NULL,
  "cached_input_tokens" integer DEFAULT 0 NOT NULL,
  "cost_status" text DEFAULT 'reported'::text NOT NULL,
  CONSTRAINT "cost_events_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.decision_archive_notification_outbox
DROP TABLE IF EXISTS "public"."decision_archive_notification_outbox" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."decision_archive_notification_outbox" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "source_kind" text NOT NULL,
  "source_id" text NOT NULL,
  "archive_version" integer NOT NULL,
  "origin_agent_id" uuid NOT NULL,
  "origin_issue_id" uuid NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "decision_archive_notification_outbox_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.decision_bundles
DROP TABLE IF EXISTS "public"."decision_bundles" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."decision_bundles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "title" text NOT NULL,
  "summary" text NOT NULL,
  "origin_agent_id" uuid NOT NULL,
  "origin_issue_id" uuid NOT NULL,
  "origin_run_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "decision_bundles_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.decision_effect_executions
DROP TABLE IF EXISTS "public"."decision_effect_executions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."decision_effect_executions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "decision_id" uuid NOT NULL,
  "effect_index" integer NOT NULL,
  "effect_type" text NOT NULL,
  "target_issue_id" uuid NOT NULL,
  "status" text DEFAULT 'claimed'::text NOT NULL,
  "result" jsonb,
  "error" text,
  "activity_log_id" uuid,
  "executed_at" timestamp with time zone,
  CONSTRAINT "decision_effect_executions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.decision_queue_items
DROP TABLE IF EXISTS "public"."decision_queue_items" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."decision_queue_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "queue_id" uuid NOT NULL,
  "source_kind" text NOT NULL,
  "source_id" text NOT NULL,
  "added_by_type" text NOT NULL,
  "added_by_agent_id" uuid,
  "added_by_user_id" text,
  "added_by_run_id" uuid,
  "added_by_agent_api_key_id" uuid,
  "responsible_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "decision_queue_items_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.decision_queues
DROP TABLE IF EXISTS "public"."decision_queues" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."decision_queues" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "key" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "created_by_type" text NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_by_run_id" uuid,
  "created_by_agent_api_key_id" uuid,
  "retention_days" integer,
  "seed_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "seed_rules_enabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "decision_queues_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.decision_retention
DROP TABLE IF EXISTS "public"."decision_retention" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."decision_retention" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "source_kind" text NOT NULL,
  "source_id" text NOT NULL,
  "source_activity_at" timestamp with time zone NOT NULL,
  "keep" boolean DEFAULT false NOT NULL,
  "archived_at" timestamp with time zone,
  "archived_reason" text,
  "archived_by_type" text,
  "archived_by_agent_id" uuid,
  "archived_by_user_id" text,
  "archived_by_run_id" uuid,
  "version" integer DEFAULT 1 NOT NULL,
  "archive_version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "decision_retention_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.decision_target_issues
DROP TABLE IF EXISTS "public"."decision_target_issues" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."decision_target_issues" (
  "decision_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  CONSTRAINT "decision_target_issues_decision_id_issue_id_pk" PRIMARY KEY ("decision_id", "issue_id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.decision_training_examples
DROP TABLE IF EXISTS "public"."decision_training_examples" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."decision_training_examples" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "source_kind" text NOT NULL,
  "source_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "cutoff_at" timestamp with time zone NOT NULL,
  "notes" text DEFAULT ''::text NOT NULL,
  "notes_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "decision_outcome" text,
  "snapshot" jsonb NOT NULL,
  "created_by_user_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "retention_policy" text DEFAULT 'scrub_deleted_comments_v1'::text NOT NULL,
  CONSTRAINT "decision_training_examples_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.decision_triage
DROP TABLE IF EXISTS "public"."decision_triage" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."decision_triage" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "source_kind" text NOT NULL,
  "source_id" text NOT NULL,
  "decide_by" text,
  "decide_by_date" date,
  "snoozed_until" timestamp with time zone,
  "set_by_type" text NOT NULL,
  "set_by_agent_id" uuid,
  "set_by_user_id" text,
  "set_by_run_id" uuid,
  "set_by_agent_api_key_id" uuid,
  "responsible_user_id" text,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "decision_triage_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.decision_triage_events
DROP TABLE IF EXISTS "public"."decision_triage_events" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."decision_triage_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "queue_id" uuid,
  "source_kind" text,
  "source_id" text,
  "action" text NOT NULL,
  "actor_type" text NOT NULL,
  "actor_agent_id" uuid,
  "actor_user_id" text,
  "actor_run_id" uuid,
  "agent_api_key_id" uuid,
  "responsible_user_id" text,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "decision_triage_events_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.decisions
DROP TABLE IF EXISTS "public"."decisions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."decisions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "bundle_id" uuid,
  "origin_agent_id" uuid NOT NULL,
  "origin_issue_id" uuid NOT NULL,
  "origin_run_id" uuid NOT NULL,
  "rule_key" text,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "options" jsonb NOT NULL,
  "inputs" jsonb,
  "status" text DEFAULT 'open'::text NOT NULL,
  "execution_status" text,
  "chosen_option_id" text,
  "input_values" jsonb,
  "decided_by_user_id" text,
  "decided_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "idempotency_key" text,
  "signed_spec" text NOT NULL,
  "target_snapshots" jsonb NOT NULL,
  "continuation_policy" text DEFAULT 'none'::text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.document_annotation_anchor_snapshots
DROP TABLE IF EXISTS "public"."document_annotation_anchor_snapshots" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."document_annotation_anchor_snapshots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "thread_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "from_revision_id" uuid,
  "from_revision_number" integer,
  "to_revision_id" uuid,
  "to_revision_number" integer NOT NULL,
  "previous_anchor" jsonb NOT NULL,
  "next_anchor" jsonb,
  "anchor_state" text NOT NULL,
  "anchor_confidence" text NOT NULL,
  "failure_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "document_annotation_anchor_snapshots_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.document_annotation_comments
DROP TABLE IF EXISTS "public"."document_annotation_comments" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."document_annotation_comments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "thread_id" uuid NOT NULL,
  "issue_id" uuid,
  "document_id" uuid NOT NULL,
  "body" text NOT NULL,
  "author_type" text NOT NULL,
  "author_agent_id" uuid,
  "author_user_id" text,
  "created_by_run_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "issue_comment_id" uuid,
  "routine_id" uuid,
  "source_trust" jsonb,
  "case_id" uuid,
  CONSTRAINT "document_annotation_comments_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.document_annotation_threads
DROP TABLE IF EXISTS "public"."document_annotation_threads" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."document_annotation_threads" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "issue_id" uuid,
  "document_id" uuid NOT NULL,
  "document_key" text NOT NULL,
  "status" text DEFAULT 'open'::text NOT NULL,
  "anchor_state" text DEFAULT 'active'::text NOT NULL,
  "original_revision_id" uuid,
  "original_revision_number" integer NOT NULL,
  "current_revision_id" uuid,
  "current_revision_number" integer NOT NULL,
  "selected_text" text NOT NULL,
  "prefix_text" text DEFAULT ''::text NOT NULL,
  "suffix_text" text DEFAULT ''::text NOT NULL,
  "normalized_start" integer NOT NULL,
  "normalized_end" integer NOT NULL,
  "markdown_start" integer NOT NULL,
  "markdown_end" integer NOT NULL,
  "anchor_confidence" text DEFAULT 'exact'::text NOT NULL,
  "anchor_selector" jsonb NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "resolved_by_agent_id" uuid,
  "resolved_by_user_id" text,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "routine_id" uuid,
  "case_id" uuid,
  CONSTRAINT "document_annotation_threads_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.document_memberships
DROP TABLE IF EXISTS "public"."document_memberships" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."document_memberships" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "starred_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "document_memberships_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.document_revisions
DROP TABLE IF EXISTS "public"."document_revisions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."document_revisions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "revision_number" integer NOT NULL,
  "body" text NOT NULL,
  "change_summary" text,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "title" text,
  "format" text DEFAULT 'markdown'::text NOT NULL,
  "created_by_run_id" uuid,
  CONSTRAINT "document_revisions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.documents
DROP TABLE IF EXISTS "public"."documents" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."documents" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "title" text,
  "format" text DEFAULT 'markdown'::text NOT NULL,
  "latest_body" text NOT NULL,
  "latest_revision_id" uuid,
  "latest_revision_number" integer DEFAULT 1 NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "updated_by_agent_id" uuid,
  "updated_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_at" timestamp with time zone,
  "locked_by_agent_id" uuid,
  "locked_by_user_id" text,
  "source_trust" jsonb,
  CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.environment_custom_image_setup_sessions
DROP TABLE IF EXISTS "public"."environment_custom_image_setup_sessions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."environment_custom_image_setup_sessions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "environment_id" uuid NOT NULL,
  "template_id" uuid,
  "promoted_template_id" uuid,
  "provider" text NOT NULL,
  "provider_lease_id" text,
  "environment_lease_id" uuid,
  "status" text DEFAULT 'starting'::text NOT NULL,
  "started_by_user_id" text,
  "started_by_agent_id" uuid,
  "base_template_ref" text,
  "expires_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "failure_reason" text,
  "connection_summary" jsonb,
  "connection_secret_ref" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "environment_custom_image_setup_sessions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.environment_custom_image_templates
DROP TABLE IF EXISTS "public"."environment_custom_image_templates" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."environment_custom_image_templates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "environment_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "template_kind" text DEFAULT 'unknown'::text NOT NULL,
  "template_ref" text NOT NULL,
  "source_template_ref" text,
  "source_environment_config_fingerprint" text,
  "status" text DEFAULT 'active'::text NOT NULL,
  "created_by_user_id" text,
  "created_by_agent_id" uuid,
  "captured_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "superseded_by_template_id" uuid,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "environment_custom_image_templates_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.environment_leases
DROP TABLE IF EXISTS "public"."environment_leases" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."environment_leases" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "environment_id" uuid NOT NULL,
  "execution_workspace_id" uuid,
  "issue_id" uuid,
  "heartbeat_run_id" uuid,
  "status" text DEFAULT 'active'::text NOT NULL,
  "lease_policy" text DEFAULT 'ephemeral'::text NOT NULL,
  "provider" text,
  "provider_lease_id" text,
  "acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  "released_at" timestamp with time zone,
  "failure_reason" text,
  "cleanup_status" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "environment_leases_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.environments
DROP TABLE IF EXISTS "public"."environments" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."environments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "driver" text DEFAULT 'local'::text NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "env_vars" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "environments_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.execution_workspaces
DROP TABLE IF EXISTS "public"."execution_workspaces" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."execution_workspaces" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "project_workspace_id" uuid,
  "source_issue_id" uuid,
  "mode" text NOT NULL,
  "strategy_type" text NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "cwd" text,
  "repo_url" text,
  "base_ref" text,
  "branch_name" text,
  "provider_type" text DEFAULT 'local_fs'::text NOT NULL,
  "provider_ref" text,
  "derived_from_execution_workspace_id" uuid,
  "last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "closed_at" timestamp with time zone,
  "cleanup_eligible_at" timestamp with time zone,
  "cleanup_reason" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "execution_workspaces_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.external_object_mentions
DROP TABLE IF EXISTS "public"."external_object_mentions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."external_object_mentions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "source_issue_id" uuid NOT NULL,
  "source_kind" text NOT NULL,
  "source_record_id" uuid,
  "document_key" text,
  "property_key" text,
  "matched_text_redacted" text,
  "sanitized_display_url" text,
  "canonical_identity_hash" text,
  "canonical_identity" jsonb,
  "object_id" uuid,
  "provider_key" text,
  "detector_key" text,
  "object_type" text,
  "confidence" text DEFAULT 'exact'::text NOT NULL,
  "created_by_plugin_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "external_object_mentions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.external_objects
DROP TABLE IF EXISTS "public"."external_objects" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."external_objects" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "provider_key" text NOT NULL,
  "plugin_id" uuid,
  "object_type" text NOT NULL,
  "external_id" text NOT NULL,
  "sanitized_canonical_url" text,
  "canonical_identity_hash" text,
  "display_title" text,
  "status_key" text,
  "status_label" text,
  "status_category" text DEFAULT 'unknown'::text NOT NULL,
  "status_tone" text DEFAULT 'neutral'::text NOT NULL,
  "liveness" text DEFAULT 'unknown'::text NOT NULL,
  "is_terminal" boolean DEFAULT false NOT NULL,
  "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "remote_version" text,
  "etag" text,
  "last_resolved_at" timestamp with time zone,
  "last_changed_at" timestamp with time zone,
  "last_error_at" timestamp with time zone,
  "next_refresh_at" timestamp with time zone,
  "last_error_code" text,
  "last_error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "display_key" text,
  "icon_key" text,
  "status_icon_key" text,
  "refresh_started_at" timestamp with time zone,
  "refresh_token" uuid,
  CONSTRAINT "external_objects_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.feedback_exports
DROP TABLE IF EXISTS "public"."feedback_exports" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."feedback_exports" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "feedback_vote_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "project_id" uuid,
  "author_user_id" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "vote" text NOT NULL,
  "status" text DEFAULT 'local_only'::text NOT NULL,
  "destination" text,
  "export_id" text,
  "consent_version" text,
  "schema_version" text DEFAULT 'paperclip-feedback-envelope-v2'::text NOT NULL,
  "bundle_version" text DEFAULT 'paperclip-feedback-bundle-v2'::text NOT NULL,
  "payload_version" text DEFAULT 'paperclip-feedback-v1'::text NOT NULL,
  "payload_digest" text,
  "payload_snapshot" jsonb,
  "target_summary" jsonb NOT NULL,
  "redaction_summary" jsonb,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_attempted_at" timestamp with time zone,
  "exported_at" timestamp with time zone,
  "failure_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "feedback_exports_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.feedback_votes
DROP TABLE IF EXISTS "public"."feedback_votes" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."feedback_votes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "author_user_id" text NOT NULL,
  "vote" text NOT NULL,
  "reason" text,
  "shared_with_labs" boolean DEFAULT false NOT NULL,
  "shared_at" timestamp with time zone,
  "consent_version" text,
  "redaction_summary" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "feedback_votes_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.finance_events
DROP TABLE IF EXISTS "public"."finance_events" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."finance_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_id" uuid,
  "issue_id" uuid,
  "project_id" uuid,
  "goal_id" uuid,
  "heartbeat_run_id" uuid,
  "cost_event_id" uuid,
  "billing_code" text,
  "description" text,
  "event_kind" text NOT NULL,
  "direction" text DEFAULT 'debit'::text NOT NULL,
  "biller" text NOT NULL,
  "provider" text,
  "execution_adapter_type" text,
  "pricing_tier" text,
  "region" text,
  "model" text,
  "quantity" integer,
  "unit" text,
  "amount_cents" integer NOT NULL,
  "currency" text DEFAULT 'USD'::text NOT NULL,
  "estimated" boolean DEFAULT false NOT NULL,
  "external_invoice_id" text,
  "metadata_json" jsonb,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "finance_events_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.folders
DROP TABLE IF EXISTS "public"."folders" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."folders" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "color" text,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "parent_id" uuid,
  "slug" text NOT NULL,
  "system_key" text,
  CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.goals
DROP TABLE IF EXISTS "public"."goals" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."goals" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "level" text DEFAULT 'task'::text NOT NULL,
  "status" text DEFAULT 'planned'::text NOT NULL,
  "parent_id" uuid,
  "owner_agent_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.heartbeat_run_events
DROP TABLE IF EXISTS "public"."heartbeat_run_events" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."heartbeat_run_events" (
  "id" bigint DEFAULT nextval('heartbeat_run_events_id_seq'::regclass) NOT NULL,
  "company_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "seq" integer NOT NULL,
  "event_type" text NOT NULL,
  "stream" text,
  "level" text,
  "color" text,
  "message" text,
  "payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "heartbeat_run_events_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.heartbeat_run_watchdog_decisions
DROP TABLE IF EXISTS "public"."heartbeat_run_watchdog_decisions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."heartbeat_run_watchdog_decisions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "evaluation_issue_id" uuid,
  "decision" text NOT NULL,
  "snoozed_until" timestamp with time zone,
  "reason" text,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_by_run_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "heartbeat_run_watchdog_decisions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.heartbeat_runs
DROP TABLE IF EXISTS "public"."heartbeat_runs" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."heartbeat_runs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "invocation_source" text DEFAULT 'on_demand'::text NOT NULL,
  "status" text DEFAULT 'queued'::text NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "error" text,
  "external_run_id" text,
  "context_snapshot" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "trigger_detail" text,
  "wakeup_request_id" uuid,
  "exit_code" integer,
  "signal" text,
  "usage_json" jsonb,
  "result_json" jsonb,
  "session_id_before" text,
  "session_id_after" text,
  "log_store" text,
  "log_ref" text,
  "log_bytes" bigint,
  "log_sha256" text,
  "log_compressed" boolean DEFAULT false NOT NULL,
  "stdout_excerpt" text,
  "stderr_excerpt" text,
  "error_code" text,
  "process_pid" integer,
  "process_started_at" timestamp with time zone,
  "retry_of_run_id" uuid,
  "process_loss_retry_count" integer DEFAULT 0 NOT NULL,
  "issue_comment_status" text DEFAULT 'not_applicable'::text NOT NULL,
  "issue_comment_satisfied_by_comment_id" uuid,
  "issue_comment_retry_queued_at" timestamp with time zone,
  "process_group_id" integer,
  "liveness_state" text,
  "liveness_reason" text,
  "continuation_attempt" integer DEFAULT 0 NOT NULL,
  "last_useful_action_at" timestamp with time zone,
  "next_action" text,
  "scheduled_retry_at" timestamp with time zone,
  "scheduled_retry_attempt" integer DEFAULT 0 NOT NULL,
  "scheduled_retry_reason" text,
  "last_output_at" timestamp with time zone,
  "last_output_seq" integer DEFAULT 0 NOT NULL,
  "last_output_stream" text,
  "last_output_bytes" bigint,
  "responsible_user_id" text,
  CONSTRAINT "heartbeat_runs_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.inbox_dismissals
DROP TABLE IF EXISTS "public"."inbox_dismissals" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."inbox_dismissals" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "item_key" text NOT NULL,
  "dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "kind" text DEFAULT 'dismiss'::text NOT NULL,
  "snoozed_until" timestamp with time zone,
  CONSTRAINT "inbox_dismissals_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.instance_settings
DROP TABLE IF EXISTS "public"."instance_settings" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."instance_settings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "singleton_key" text DEFAULT 'default'::text NOT NULL,
  "experimental" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "general" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "default_environment_id" uuid,
  CONSTRAINT "instance_settings_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.instance_user_roles
DROP TABLE IF EXISTS "public"."instance_user_roles" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."instance_user_roles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "role" text DEFAULT 'instance_admin'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "instance_user_roles_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.invites
DROP TABLE IF EXISTS "public"."invites" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."invites" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid,
  "invite_type" text DEFAULT 'company_join'::text NOT NULL,
  "token_hash" text NOT NULL,
  "allowed_join_types" text DEFAULT 'both'::text NOT NULL,
  "defaults_payload" jsonb,
  "expires_at" timestamp with time zone NOT NULL,
  "invited_by_user_id" text,
  "revoked_at" timestamp with time zone,
  "accepted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issue_approvals
DROP TABLE IF EXISTS "public"."issue_approvals" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issue_approvals" (
  "company_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "approval_id" uuid NOT NULL,
  "linked_by_agent_id" uuid,
  "linked_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "issue_approvals_pk" PRIMARY KEY ("issue_id", "approval_id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issue_attachments
DROP TABLE IF EXISTS "public"."issue_attachments" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issue_attachments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "issue_comment_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "issue_attachments_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issue_comments
DROP TABLE IF EXISTS "public"."issue_comments" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issue_comments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "author_agent_id" uuid,
  "author_user_id" text,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_run_id" uuid,
  "author_type" text,
  "presentation" jsonb,
  "metadata" jsonb,
  "deleted_at" timestamp with time zone,
  "deleted_by_type" text,
  "deleted_by_agent_id" uuid,
  "deleted_by_user_id" text,
  "deleted_by_run_id" uuid,
  "source_trust" jsonb,
  "derived_author_agent_id" uuid,
  "derived_created_by_run_id" uuid,
  "derived_author_source" text,
  "on_behalf_of_user_id" text,
  CONSTRAINT "issue_comments_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issue_create_idempotency_keys
DROP TABLE IF EXISTS "public"."issue_create_idempotency_keys" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issue_create_idempotency_keys" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "idempotency_key" text NOT NULL,
  "issue_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "issue_create_idempotency_keys_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issue_documents
DROP TABLE IF EXISTS "public"."issue_documents" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issue_documents" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "issue_documents_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issue_execution_decisions
DROP TABLE IF EXISTS "public"."issue_execution_decisions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issue_execution_decisions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "stage_id" uuid NOT NULL,
  "stage_type" text NOT NULL,
  "actor_agent_id" uuid,
  "actor_user_id" text,
  "outcome" text NOT NULL,
  "body" text NOT NULL,
  "created_by_run_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "issue_execution_decisions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issue_inbox_archives
DROP TABLE IF EXISTS "public"."issue_inbox_archives" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issue_inbox_archives" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "archived_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_by_actor_type" text DEFAULT 'user'::text NOT NULL,
  "archived_by_agent_id" uuid,
  "archived_by_run_id" uuid,
  CONSTRAINT "issue_inbox_archives_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issue_labels
DROP TABLE IF EXISTS "public"."issue_labels" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issue_labels" (
  "issue_id" uuid NOT NULL,
  "label_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "issue_labels_pk" PRIMARY KEY ("issue_id", "label_id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issue_plan_decompositions
DROP TABLE IF EXISTS "public"."issue_plan_decompositions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issue_plan_decompositions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "source_issue_id" uuid NOT NULL,
  "accepted_plan_revision_id" uuid NOT NULL,
  "accepted_interaction_id" uuid,
  "status" text DEFAULT 'in_flight'::text NOT NULL,
  "request_fingerprint" text NOT NULL,
  "requested_child_count" integer DEFAULT 0 NOT NULL,
  "requested_children" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "child_issue_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "owner_agent_id" uuid,
  "owner_user_id" text,
  "owner_run_id" uuid,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "issue_plan_decompositions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issue_read_states
DROP TABLE IF EXISTS "public"."issue_read_states" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issue_read_states" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "issue_read_states_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issue_recovery_actions
DROP TABLE IF EXISTS "public"."issue_recovery_actions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issue_recovery_actions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "source_issue_id" uuid NOT NULL,
  "recovery_issue_id" uuid,
  "kind" text NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "owner_type" text DEFAULT 'agent'::text NOT NULL,
  "owner_agent_id" uuid,
  "owner_user_id" text,
  "previous_owner_agent_id" uuid,
  "return_owner_agent_id" uuid,
  "cause" text NOT NULL,
  "fingerprint" text NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "next_action" text NOT NULL,
  "wake_policy" jsonb,
  "monitor_policy" jsonb,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer,
  "timeout_at" timestamp with time zone,
  "last_attempt_at" timestamp with time zone,
  "outcome" text,
  "resolution_note" text,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "issue_recovery_actions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issue_reference_mentions
DROP TABLE IF EXISTS "public"."issue_reference_mentions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issue_reference_mentions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "source_issue_id" uuid NOT NULL,
  "target_issue_id" uuid NOT NULL,
  "source_kind" text NOT NULL,
  "source_record_id" uuid,
  "document_key" text,
  "matched_text" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "issue_reference_mentions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issue_relations
DROP TABLE IF EXISTS "public"."issue_relations" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issue_relations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "related_issue_id" uuid NOT NULL,
  "type" text NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "issue_relations_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issue_thread_interactions
DROP TABLE IF EXISTS "public"."issue_thread_interactions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issue_thread_interactions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "continuation_policy" text DEFAULT 'wake_assignee'::text NOT NULL,
  "source_comment_id" uuid,
  "source_run_id" uuid,
  "title" text,
  "summary" text,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "resolved_by_agent_id" uuid,
  "resolved_by_user_id" text,
  "payload" jsonb NOT NULL,
  "result" jsonb,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "idempotency_key" text,
  "requested_resolver_policy" text DEFAULT 'board_only'::text NOT NULL,
  "effective_resolver_policy" text DEFAULT 'board_only'::text NOT NULL,
  "resolved_by_run_id" uuid,
  "addressee_agent_id" uuid,
  CONSTRAINT "issue_thread_interactions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issue_tree_hold_members
DROP TABLE IF EXISTS "public"."issue_tree_hold_members" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issue_tree_hold_members" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "hold_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "parent_issue_id" uuid,
  "depth" integer DEFAULT 0 NOT NULL,
  "issue_identifier" text,
  "issue_title" text NOT NULL,
  "issue_status" text NOT NULL,
  "assignee_agent_id" uuid,
  "assignee_user_id" text,
  "active_run_id" uuid,
  "active_run_status" text,
  "skipped" boolean DEFAULT false NOT NULL,
  "skip_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "issue_tree_hold_members_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issue_tree_holds
DROP TABLE IF EXISTS "public"."issue_tree_holds" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issue_tree_holds" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "root_issue_id" uuid NOT NULL,
  "mode" text NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "reason" text,
  "release_policy" jsonb,
  "created_by_actor_type" text DEFAULT 'system'::text NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_by_run_id" uuid,
  "released_at" timestamp with time zone,
  "released_by_actor_type" text,
  "released_by_agent_id" uuid,
  "released_by_user_id" text,
  "released_by_run_id" uuid,
  "release_reason" text,
  "release_metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "issue_tree_holds_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issue_watchdogs
DROP TABLE IF EXISTS "public"."issue_watchdogs" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issue_watchdogs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "watchdog_agent_id" uuid NOT NULL,
  "instructions" text,
  "status" text DEFAULT 'active'::text NOT NULL,
  "watchdog_issue_id" uuid,
  "last_observed_fingerprint" text,
  "last_reviewed_fingerprint" text,
  "last_triggered_at" timestamp with time zone,
  "last_completed_at" timestamp with time zone,
  "trigger_count" integer DEFAULT 0 NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_by_run_id" uuid,
  "updated_by_agent_id" uuid,
  "updated_by_user_id" text,
  "updated_by_run_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_observed_stop_snapshot" jsonb,
  "last_reviewed_stop_snapshot" jsonb,
  CONSTRAINT "issue_watchdogs_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issue_work_products
DROP TABLE IF EXISTS "public"."issue_work_products" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issue_work_products" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "project_id" uuid,
  "issue_id" uuid NOT NULL,
  "execution_workspace_id" uuid,
  "runtime_service_id" uuid,
  "type" text NOT NULL,
  "provider" text NOT NULL,
  "external_id" text,
  "title" text NOT NULL,
  "url" text,
  "status" text NOT NULL,
  "review_state" text DEFAULT 'none'::text NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "health_status" text DEFAULT 'unknown'::text NOT NULL,
  "summary" text,
  "metadata" jsonb,
  "created_by_run_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source_trust" jsonb,
  CONSTRAINT "issue_work_products_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.issues
DROP TABLE IF EXISTS "public"."issues" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."issues" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "project_id" uuid,
  "goal_id" uuid,
  "parent_id" uuid,
  "title" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'backlog'::text NOT NULL,
  "priority" text DEFAULT 'medium'::text NOT NULL,
  "assignee_agent_id" uuid,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "request_depth" integer DEFAULT 0 NOT NULL,
  "billing_code" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "issue_number" integer,
  "identifier" text,
  "hidden_at" timestamp with time zone,
  "checkout_run_id" uuid,
  "execution_run_id" uuid,
  "execution_agent_name_key" text,
  "execution_locked_at" timestamp with time zone,
  "assignee_user_id" text,
  "assignee_adapter_overrides" jsonb,
  "execution_workspace_settings" jsonb,
  "project_workspace_id" uuid,
  "execution_workspace_id" uuid,
  "execution_workspace_preference" text,
  "origin_kind" text DEFAULT 'manual'::text NOT NULL,
  "origin_id" text,
  "origin_run_id" text,
  "execution_policy" jsonb,
  "execution_state" jsonb,
  "origin_fingerprint" text DEFAULT 'default'::text NOT NULL,
  "monitor_next_check_at" timestamp with time zone,
  "monitor_wake_requested_at" timestamp with time zone,
  "monitor_last_triggered_at" timestamp with time zone,
  "monitor_attempt_count" integer DEFAULT 0 NOT NULL,
  "monitor_notes" text,
  "monitor_scheduled_by" text,
  "work_mode" text DEFAULT 'standard'::text NOT NULL,
  "source_trust" jsonb,
  "responsible_user_id" text,
  "harness_kind" text,
  "unblock_descriptor" jsonb,
  "blocked_transition_at" timestamp with time zone,
  "blocked_owner_notified_at" timestamp with time zone,
  "review_policy" text,
  CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.join_requests
DROP TABLE IF EXISTS "public"."join_requests" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."join_requests" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "invite_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "request_type" text NOT NULL,
  "status" text DEFAULT 'pending_approval'::text NOT NULL,
  "request_ip" text NOT NULL,
  "requesting_user_id" text,
  "request_email_snapshot" text,
  "agent_name" text,
  "adapter_type" text,
  "capabilities" text,
  "agent_defaults_payload" jsonb,
  "created_agent_id" uuid,
  "approved_by_user_id" text,
  "approved_at" timestamp with time zone,
  "rejected_by_user_id" text,
  "rejected_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "claim_secret_hash" text,
  "claim_secret_expires_at" timestamp with time zone,
  "claim_secret_consumed_at" timestamp with time zone,
  CONSTRAINT "join_requests_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.labels
DROP TABLE IF EXISTS "public"."labels" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."labels" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "color" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.pipeline_automation_executions
DROP TABLE IF EXISTS "public"."pipeline_automation_executions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."pipeline_automation_executions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "automation_id" text NOT NULL,
  "triggering_event_id" uuid NOT NULL,
  "routine_id" uuid NOT NULL,
  "status" text NOT NULL,
  "execution_issue_id" uuid,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "retry_of_execution_id" uuid,
  "generation" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "pipeline_automation_executions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.pipeline_case_blockers
DROP TABLE IF EXISTS "public"."pipeline_case_blockers" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."pipeline_case_blockers" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "blocked_by_case_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pipeline_case_blockers_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.pipeline_case_documents
DROP TABLE IF EXISTS "public"."pipeline_case_documents" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."pipeline_case_documents" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pipeline_case_documents_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.pipeline_case_events
DROP TABLE IF EXISTS "public"."pipeline_case_events" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."pipeline_case_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "type" text NOT NULL,
  "actor_type" text NOT NULL,
  "actor_user_id" text,
  "actor_agent_id" uuid,
  "run_id" uuid,
  "from_stage_id" uuid,
  "to_stage_id" uuid,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pipeline_case_events_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.pipeline_case_issue_links
DROP TABLE IF EXISTS "public"."pipeline_case_issue_links" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."pipeline_case_issue_links" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "role" text NOT NULL,
  "created_by_run_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "automation_attempt_id" uuid,
  "retired_at" timestamp with time zone,
  "retired_by_attempt_id" uuid,
  "retired_reason" text,
  CONSTRAINT "pipeline_case_issue_links_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.pipeline_cases
DROP TABLE IF EXISTS "public"."pipeline_cases" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."pipeline_cases" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "pipeline_id" uuid NOT NULL,
  "stage_id" uuid NOT NULL,
  "case_key" text NOT NULL,
  "title" text NOT NULL,
  "summary" text,
  "fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "workspace_ref" jsonb,
  "parent_case_id" uuid,
  "version" integer DEFAULT 1 NOT NULL,
  "pending_suggestion" jsonb,
  "lease_owner_type" text,
  "lease_agent_id" uuid,
  "lease_user_id" text,
  "lease_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "terminal_kind" text,
  "terminal_at" timestamp with time zone,
  "child_count" integer DEFAULT 0 NOT NULL,
  "terminal_child_count" integer DEFAULT 0 NOT NULL,
  "created_by_user_id" text,
  "created_by_agent_id" uuid,
  "origin_run_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "parent_case_version" integer,
  "request_key" text,
  "automation_attempt_id" uuid,
  "retired_at" timestamp with time zone,
  "retired_by_attempt_id" uuid,
  "retired_reason" text,
  "hidden_from_board_at" timestamp with time zone,
  CONSTRAINT "pipeline_cases_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.pipeline_documents
DROP TABLE IF EXISTS "public"."pipeline_documents" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."pipeline_documents" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "pipeline_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pipeline_documents_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.pipeline_stages
DROP TABLE IF EXISTS "public"."pipeline_stages" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."pipeline_stages" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "pipeline_id" uuid NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "position" integer NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.pipeline_transitions
DROP TABLE IF EXISTS "public"."pipeline_transitions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."pipeline_transitions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "pipeline_id" uuid NOT NULL,
  "from_stage_id" uuid NOT NULL,
  "to_stage_id" uuid NOT NULL,
  "label" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pipeline_transitions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.pipelines
DROP TABLE IF EXISTS "public"."pipelines" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."pipelines" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "project_id" uuid,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "enforce_transitions" boolean DEFAULT false NOT NULL,
  "created_by_user_id" text,
  "created_by_agent_id" uuid,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.plugin_company_settings
DROP TABLE IF EXISTS "public"."plugin_company_settings" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."plugin_company_settings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "plugin_id" uuid NOT NULL,
  "settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  CONSTRAINT "plugin_company_settings_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.plugin_config
DROP TABLE IF EXISTS "public"."plugin_config" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."plugin_config" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "plugin_id" uuid NOT NULL,
  "config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "company_id" uuid NOT NULL,
  CONSTRAINT "plugin_config_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.plugin_database_namespaces
DROP TABLE IF EXISTS "public"."plugin_database_namespaces" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."plugin_database_namespaces" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "plugin_id" uuid NOT NULL,
  "plugin_key" text NOT NULL,
  "namespace_name" text NOT NULL,
  "namespace_mode" text DEFAULT 'schema'::text NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plugin_database_namespaces_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.plugin_entities
DROP TABLE IF EXISTS "public"."plugin_entities" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."plugin_entities" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "plugin_id" uuid NOT NULL,
  "entity_type" text NOT NULL,
  "scope_kind" text NOT NULL,
  "scope_id" text,
  "external_id" text,
  "title" text,
  "status" text,
  "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "company_id" uuid,
  CONSTRAINT "plugin_entities_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.plugin_job_runs
DROP TABLE IF EXISTS "public"."plugin_job_runs" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."plugin_job_runs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL,
  "plugin_id" uuid NOT NULL,
  "trigger" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "duration_ms" integer,
  "error" text,
  "logs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "company_id" uuid,
  CONSTRAINT "plugin_job_runs_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.plugin_jobs
DROP TABLE IF EXISTS "public"."plugin_jobs" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."plugin_jobs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "plugin_id" uuid NOT NULL,
  "job_key" text NOT NULL,
  "schedule" text NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "last_run_at" timestamp with time zone,
  "next_run_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plugin_jobs_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.plugin_logs
DROP TABLE IF EXISTS "public"."plugin_logs" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."plugin_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "plugin_id" uuid NOT NULL,
  "level" text DEFAULT 'info'::text NOT NULL,
  "message" text NOT NULL,
  "meta" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "company_id" uuid,
  CONSTRAINT "plugin_logs_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.plugin_managed_resources
DROP TABLE IF EXISTS "public"."plugin_managed_resources" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."plugin_managed_resources" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "plugin_id" uuid NOT NULL,
  "plugin_key" text NOT NULL,
  "resource_kind" text NOT NULL,
  "resource_key" text NOT NULL,
  "resource_id" uuid NOT NULL,
  "defaults_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plugin_managed_resources_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.plugin_migrations
DROP TABLE IF EXISTS "public"."plugin_migrations" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."plugin_migrations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "plugin_id" uuid NOT NULL,
  "plugin_key" text NOT NULL,
  "namespace_name" text NOT NULL,
  "migration_key" text NOT NULL,
  "checksum" text NOT NULL,
  "plugin_version" text NOT NULL,
  "status" text NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "applied_at" timestamp with time zone,
  "error_message" text,
  CONSTRAINT "plugin_migrations_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.plugin_state
DROP TABLE IF EXISTS "public"."plugin_state" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."plugin_state" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "plugin_id" uuid NOT NULL,
  "scope_kind" text NOT NULL,
  "scope_id" text,
  "namespace" text DEFAULT 'default'::text NOT NULL,
  "state_key" text NOT NULL,
  "value_json" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plugin_state_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.plugin_webhook_deliveries
DROP TABLE IF EXISTS "public"."plugin_webhook_deliveries" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."plugin_webhook_deliveries" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "plugin_id" uuid NOT NULL,
  "webhook_key" text NOT NULL,
  "external_id" text,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "duration_ms" integer,
  "error" text,
  "payload" jsonb NOT NULL,
  "headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "company_id" uuid,
  CONSTRAINT "plugin_webhook_deliveries_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.plugins
DROP TABLE IF EXISTS "public"."plugins" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."plugins" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "plugin_key" text NOT NULL,
  "package_name" text NOT NULL,
  "package_path" text,
  "version" text NOT NULL,
  "api_version" integer DEFAULT 1 NOT NULL,
  "categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "manifest_json" jsonb NOT NULL,
  "status" text DEFAULT 'installed'::text NOT NULL,
  "install_order" integer,
  "last_error" text,
  "installed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plugins_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.principal_permission_grants
DROP TABLE IF EXISTS "public"."principal_permission_grants" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."principal_permission_grants" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "principal_type" text NOT NULL,
  "principal_id" text NOT NULL,
  "permission_key" text NOT NULL,
  "scope" jsonb,
  "granted_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "principal_permission_grants_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.project_goals
DROP TABLE IF EXISTS "public"."project_goals" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."project_goals" (
  "project_id" uuid NOT NULL,
  "goal_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_goals_project_id_goal_id_pk" PRIMARY KEY ("project_id", "goal_id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.project_memberships
DROP TABLE IF EXISTS "public"."project_memberships" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."project_memberships" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "state" text DEFAULT 'joined'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "starred_at" timestamp with time zone,
  CONSTRAINT "project_memberships_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.project_workspaces
DROP TABLE IF EXISTS "public"."project_workspaces" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."project_workspaces" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "name" text NOT NULL,
  "cwd" text,
  "repo_url" text,
  "repo_ref" text,
  "metadata" jsonb,
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source_type" text DEFAULT 'local_path'::text NOT NULL,
  "default_ref" text,
  "visibility" text DEFAULT 'default'::text NOT NULL,
  "setup_command" text,
  "cleanup_command" text,
  "remote_provider" text,
  "remote_workspace_ref" text,
  "shared_workspace_key" text,
  CONSTRAINT "project_workspaces_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.projects
DROP TABLE IF EXISTS "public"."projects" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."projects" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "goal_id" uuid,
  "name" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'backlog'::text NOT NULL,
  "lead_agent_id" uuid,
  "target_date" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "color" text,
  "archived_at" timestamp with time zone,
  "execution_workspace_policy" jsonb,
  "pause_reason" text,
  "paused_at" timestamp with time zone,
  "env" jsonb,
  "icon" text,
  CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.routine_documents
DROP TABLE IF EXISTS "public"."routine_documents" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."routine_documents" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "routine_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "routine_documents_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.routine_revisions
DROP TABLE IF EXISTS "public"."routine_revisions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."routine_revisions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "routine_id" uuid NOT NULL,
  "revision_number" integer NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "snapshot" jsonb NOT NULL,
  "change_summary" text,
  "restored_from_revision_id" uuid,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_by_run_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "responsible_user_id" text,
  CONSTRAINT "routine_revisions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.routine_runs
DROP TABLE IF EXISTS "public"."routine_runs" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."routine_runs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "routine_id" uuid NOT NULL,
  "trigger_id" uuid,
  "source" text NOT NULL,
  "status" text DEFAULT 'received'::text NOT NULL,
  "triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
  "idempotency_key" text,
  "trigger_payload" jsonb,
  "linked_issue_id" uuid,
  "coalesced_into_run_id" uuid,
  "failure_reason" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "dispatch_fingerprint" text,
  "routine_revision_id" uuid,
  "responsible_user_id" text,
  CONSTRAINT "routine_runs_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.routine_triggers
DROP TABLE IF EXISTS "public"."routine_triggers" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."routine_triggers" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "routine_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "label" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "cron_expression" text,
  "timezone" text,
  "next_run_at" timestamp with time zone,
  "last_fired_at" timestamp with time zone,
  "public_id" text,
  "secret_id" uuid,
  "signing_mode" text,
  "replay_window_sec" integer,
  "last_rotated_at" timestamp with time zone,
  "last_result" text,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "updated_by_agent_id" uuid,
  "updated_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "routine_triggers_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.routines
DROP TABLE IF EXISTS "public"."routines" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."routines" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "project_id" uuid,
  "goal_id" uuid,
  "parent_issue_id" uuid,
  "title" text NOT NULL,
  "description" text,
  "assignee_agent_id" uuid,
  "priority" text DEFAULT 'medium'::text NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "concurrency_policy" text DEFAULT 'coalesce_if_active'::text NOT NULL,
  "catch_up_policy" text DEFAULT 'skip_missed'::text NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "updated_by_agent_id" uuid,
  "updated_by_user_id" text,
  "last_triggered_at" timestamp with time zone,
  "last_enqueued_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "latest_revision_id" uuid,
  "latest_revision_number" integer DEFAULT 1 NOT NULL,
  "env" jsonb,
  "origin_kind" text DEFAULT 'manual'::text NOT NULL,
  "origin_id" text,
  "responsible_user_id" text,
  "activity_gate_policy" text DEFAULT 'always'::text NOT NULL,
  "activity_gate_scope" text DEFAULT 'company'::text NOT NULL,
  "folder_id" uuid,
  CONSTRAINT "routines_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.secret_access_events
DROP TABLE IF EXISTS "public"."secret_access_events" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."secret_access_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "secret_id" uuid,
  "version" integer,
  "provider" text NOT NULL,
  "actor_type" text NOT NULL,
  "actor_id" text,
  "consumer_type" text NOT NULL,
  "consumer_id" text NOT NULL,
  "config_path" text,
  "issue_id" uuid,
  "heartbeat_run_id" uuid,
  "plugin_id" uuid,
  "outcome" text NOT NULL,
  "error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "user_secret_definition_id" uuid,
  "secret_scope" text DEFAULT 'company'::text NOT NULL,
  "responsible_user_id" text,
  "credential_owner_user_id" text,
  "credential_subject_type" text,
  "credential_subject_id" text,
  CONSTRAINT "secret_access_events_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.session
DROP TABLE IF EXISTS "public"."session" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."session" (
  "id" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "token" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "user_id" text NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.smoke_run_steps
DROP TABLE IF EXISTS "public"."smoke_run_steps" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."smoke_run_steps" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "path" text NOT NULL,
  "scenario_step" text NOT NULL,
  "status" text NOT NULL,
  "detail" text,
  "screenshot_artifact_ref" jsonb,
  "duration_ms" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "smoke_run_steps_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.smoke_runs
DROP TABLE IF EXISTS "public"."smoke_runs" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."smoke_runs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "trigger" text NOT NULL,
  "status" text DEFAULT 'running'::text NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "smoke_runs_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.status_card_updates
DROP TABLE IF EXISTS "public"."status_card_updates" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."status_card_updates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "card_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "trigger" text NOT NULL,
  "generation_issue_id" uuid,
  "run_id" uuid,
  "changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "cost_cents" integer DEFAULT 0 NOT NULL,
  "model" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "status" text NOT NULL,
  "error" text,
  "query_version" integer,
  "change_summary" text,
  CONSTRAINT "status_card_updates_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.status_cards
DROP TABLE IF EXISTS "public"."status_cards" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."status_cards" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "created_by_user_id" text,
  "created_by_agent_id" uuid,
  "title" text,
  "title_pinned" boolean DEFAULT false NOT NULL,
  "interest_prompt" text NOT NULL,
  "queries" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "query_version" integer DEFAULT 0 NOT NULL,
  "query_compiled_at" timestamp with time zone,
  "query_compiled_by_agent_id" uuid,
  "refresh_policy" jsonb NOT NULL,
  "state" text DEFAULT 'compiling'::text NOT NULL,
  "pending_change_count" integer DEFAULT 0 NOT NULL,
  "last_change_at" timestamp with time zone,
  "fingerprint" jsonb,
  "fingerprint_at" timestamp with time zone,
  "document_id" uuid,
  "last_update_run_kind" text,
  "last_generated_at" timestamp with time zone,
  "last_model" text,
  "generating_issue_id" uuid,
  "failure_reason" text,
  "next_eval_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "archived_by_user_id" text,
  "archived_by_agent_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "pending_change_hash" text,
  "agent_id" uuid,
  "mentioned_issue_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  CONSTRAINT "status_cards_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.summary_slots
DROP TABLE IF EXISTS "public"."summary_slots" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."summary_slots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "scope_kind" text NOT NULL,
  "scope_id" uuid,
  "slot_key" text NOT NULL,
  "document_id" uuid,
  "status" text DEFAULT 'idle'::text NOT NULL,
  "generating_issue_id" uuid,
  "last_generated_at" timestamp with time zone,
  "last_generated_by_agent_id" uuid,
  "last_model" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "failure_reason" text,
  CONSTRAINT "summary_slots_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_access_audit_events
DROP TABLE IF EXISTS "public"."tool_access_audit_events" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_access_audit_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "connection_id" uuid,
  "catalog_entry_id" uuid,
  "actor_type" text DEFAULT 'system'::text NOT NULL,
  "actor_id" text,
  "action" text NOT NULL,
  "outcome" text NOT NULL,
  "reason_code" text,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "gateway_id" uuid,
  "gateway_token_id" uuid,
  "gateway_public_id" text,
  "client_name" text,
  "correlation_id" text,
  CONSTRAINT "tool_access_audit_events_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_action_requests
DROP TABLE IF EXISTS "public"."tool_action_requests" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_action_requests" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "invocation_id" uuid NOT NULL,
  "issue_id" uuid,
  "interaction_id" uuid,
  "approval_id" uuid,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "canonical_arguments_hash" text NOT NULL,
  "canonical_arguments_summary" jsonb NOT NULL,
  "signed_arguments" text,
  "preview_markdown" text,
  "requested_by_agent_id" uuid,
  "requested_by_user_id" text,
  "resolved_by_agent_id" uuid,
  "resolved_by_user_id" text,
  "decided_by_agent_id" uuid,
  "decided_by_user_id" text,
  "decided_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tool_action_requests_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_applications
DROP TABLE IF EXISTS "public"."tool_applications" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_applications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "type" text NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "application_key" text,
  "description" text,
  "plugin_id" uuid,
  "owner_agent_id" uuid,
  "owner_user_id" text,
  "archived_at" timestamp with time zone,
  CONSTRAINT "tool_applications_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_call_events
DROP TABLE IF EXISTS "public"."tool_call_events" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_call_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "actor_type" text DEFAULT 'system'::text NOT NULL,
  "actor_id" text,
  "agent_id" uuid,
  "run_id" uuid,
  "issue_id" uuid,
  "application_id" uuid,
  "connection_id" uuid,
  "catalog_entry_id" uuid,
  "invocation_id" uuid,
  "action_request_id" uuid,
  "runtime_slot_id" uuid,
  "tool_name" text,
  "decision" text,
  "matched_policy_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "reason_code" text,
  "outcome" text DEFAULT 'pending'::text NOT NULL,
  "latency_ms" integer,
  "arguments_summary" jsonb,
  "request_hash" text,
  "request_summary" jsonb,
  "result_hash" text,
  "result_summary" jsonb,
  "result_size_bytes" integer,
  "redaction_plan" jsonb,
  "rate_limit_state" jsonb,
  "metadata" jsonb,
  "error_code" text,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "gateway_id" uuid,
  "gateway_token_id" uuid,
  "gateway_public_id" text,
  "client_subject_type" text,
  "client_subject_id" text,
  "client_name" text,
  "mcp_session_id" text,
  "correlation_id" text,
  "policy_explanation" jsonb,
  "credential_scope_summary" jsonb,
  "header_policy_summary" jsonb,
  CONSTRAINT "tool_call_events_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_catalog_entries
DROP TABLE IF EXISTS "public"."tool_catalog_entries" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_catalog_entries" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "connection_id" uuid NOT NULL,
  "name" text NOT NULL,
  "title" text,
  "description" text,
  "input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "annotations" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "risk_level" text DEFAULT 'read'::text NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "version_hash" text NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "quarantined_at" timestamp with time zone,
  "quarantine_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "application_id" uuid,
  "entry_kind" text DEFAULT 'tool'::text NOT NULL,
  "tool_name" text NOT NULL,
  "output_schema" jsonb,
  "is_read_only" boolean DEFAULT true NOT NULL,
  "is_write" boolean DEFAULT false NOT NULL,
  "is_destructive" boolean DEFAULT false NOT NULL,
  "version" text,
  "schema_hash" text,
  "reviewed_at" timestamp with time zone,
  "reviewed_by_agent_id" uuid,
  "reviewed_by_user_id" text,
  CONSTRAINT "tool_catalog_entries_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_connection_installs
DROP TABLE IF EXISTS "public"."tool_connection_installs" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_connection_installs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "connection_id" uuid NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tool_connection_installs_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_connections
DROP TABLE IF EXISTS "public"."tool_connections" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_connections" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "application_id" uuid NOT NULL,
  "name" text NOT NULL,
  "transport" text NOT NULL,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "credential_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "health_status" text DEFAULT 'unchecked'::text NOT NULL,
  "health_message" text,
  "last_health_at" timestamp with time zone,
  "last_catalog_refresh_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "connection_kind" text DEFAULT 'managed'::text NOT NULL,
  "transport_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "credential_secret_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "health_checked_at" timestamp with time zone,
  "last_error" text,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "uid" text NOT NULL,
  "ownership" text DEFAULT 'customer'::text NOT NULL,
  "auth_kind" text DEFAULT 'none'::text NOT NULL,
  CONSTRAINT "tool_connections_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_gateway_rate_limit_counters
DROP TABLE IF EXISTS "public"."tool_gateway_rate_limit_counters" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_gateway_rate_limit_counters" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "counter_key" text NOT NULL,
  "window_start_at" timestamp with time zone NOT NULL,
  "window_ms" integer NOT NULL,
  "limit" integer NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "reset_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tool_gateway_rate_limit_counters_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_gateway_sessions
DROP TABLE IF EXISTS "public"."tool_gateway_sessions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_gateway_sessions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "issue_id" uuid,
  "project_id" uuid,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "gateway_id" uuid,
  "gateway_token_id" uuid,
  "gateway_public_id" text,
  "client_subject_type" text,
  "client_subject_id" text,
  "client_name" text,
  "mcp_session_id" text,
  "correlation_id" text,
  CONSTRAINT "tool_gateway_sessions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_invocations
DROP TABLE IF EXISTS "public"."tool_invocations" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_invocations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "idempotency_key" text,
  "actor_type" text DEFAULT 'system'::text NOT NULL,
  "actor_id" text,
  "agent_id" uuid,
  "issue_id" uuid,
  "run_id" uuid,
  "application_id" uuid,
  "connection_id" uuid,
  "catalog_entry_id" uuid,
  "tool_name" text NOT NULL,
  "arguments_hash" text,
  "arguments_summary" jsonb,
  "policy_decision" text,
  "matched_policy_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "approval_state" text DEFAULT 'not_required'::text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "upstream_request_id" text,
  "result_hash" text,
  "result_summary" jsonb,
  "result_size_bytes" integer,
  "result_artifact_id" uuid,
  "error_code" text,
  "error_message" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "catalog_version_hash" text,
  "catalog_schema_hash" text,
  "provider_type" text,
  "application_key" text,
  "upstream_tool_name" text,
  "risk_level" text,
  "gateway_id" uuid,
  "gateway_token_id" uuid,
  "gateway_public_id" text,
  "client_subject_type" text,
  "client_subject_id" text,
  "client_name" text,
  "mcp_session_id" text,
  "correlation_id" text,
  "policy_explanation" jsonb,
  "credential_scope_summary" jsonb,
  "header_policy_summary" jsonb,
  CONSTRAINT "tool_invocations_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_mcp_gateway_tokens
DROP TABLE IF EXISTS "public"."tool_mcp_gateway_tokens" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_mcp_gateway_tokens" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "gateway_id" uuid NOT NULL,
  "name" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "token_prefix" text DEFAULT ''::text NOT NULL,
  "subject_type" text DEFAULT 'gateway_client'::text NOT NULL,
  "subject_id" text,
  "client_label" text DEFAULT ''::text NOT NULL,
  "owner_note" text DEFAULT ''::text NOT NULL,
  "allowed_actions" jsonb DEFAULT '["tools/list", "tools/call"]'::jsonb NOT NULL,
  "expiry_override_reason" text,
  "expiry_override_by_user_id" text,
  "expiry_override_by_agent_id" uuid,
  "expiry_override_at" timestamp with time zone,
  CONSTRAINT "tool_mcp_gateway_tokens_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_mcp_gateways
DROP TABLE IF EXISTS "public"."tool_mcp_gateways" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_mcp_gateways" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'active'::text NOT NULL,
  "profile_id" uuid NOT NULL,
  "agent_id" uuid,
  "project_id" uuid,
  "issue_id" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "gateway_public_id" text DEFAULT ('gw_'::text || replace((gen_random_uuid())::text, '-'::text, ''::text)) NOT NULL,
  "display_slug" text DEFAULT ''::text NOT NULL,
  "default_profile_mode" text DEFAULT 'gateway_only'::text NOT NULL,
  "context_scope_type" text DEFAULT 'none'::text NOT NULL,
  "context_scope_id" text,
  "approval_issue_id" uuid,
  "auth_config" jsonb DEFAULT '{"oauth": {"enabled": false, "reservedFor": "v1_5", "authorizationCodePkce": false, "dynamicClientRegistration": false}, "bearer": {"enabled": true, "tokenPrefix": "pcgw", "defaultTtlSeconds": 7776000, "requireFiniteExpiry": true, "longLivedTokenRequiresOverride": true}, "version": 1}'::jsonb NOT NULL,
  "header_policy" jsonb DEFAULT '{"version": 1, "staticHeaders": [], "responseHeaders": {"forwardSafeCacheHeaders": true, "forwardMcpRequiredHeaders": true}, "callerPassthrough": {"enabled": false, "allowedHeaders": []}, "generatedMetadata": {"enabled": false, "allowedHeaders": []}}'::jsonb NOT NULL,
  "metadata_policy" jsonb DEFAULT '{"version": 1, "forwardRunId": false, "forwardAgentId": false, "forwardIssueId": false, "forwardCompanyId": false, "forwardGatewayId": false, "forwardProjectId": false, "forwardCorrelationId": true}'::jsonb NOT NULL,
  "on_demand_tools_config" jsonb DEFAULT '{"enabled": false, "runToolName": "run_tool", "searchToolName": "search_tools"}'::jsonb NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "tool_mcp_gateways_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_oauth_states
DROP TABLE IF EXISTS "public"."tool_oauth_states" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_oauth_states" (
  "state" text NOT NULL,
  "company_id" uuid NOT NULL,
  "connection_id" uuid NOT NULL,
  "code_verifier" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_actor_type" text,
  "created_by_actor_id" text,
  "created_by_session_id" text,
  "subject_user_id" text,
  "requested_scopes" jsonb,
  "return_to" text,
  "issue_id" uuid,
  "interaction_id" uuid,
  CONSTRAINT "tool_oauth_states_pkey" PRIMARY KEY ("state")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_policies
DROP TABLE IF EXISTS "public"."tool_policies" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_policies" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "policy_type" text NOT NULL,
  "priority" integer DEFAULT 100 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "selectors" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "conditions" jsonb,
  "config" jsonb,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tool_policies_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_profile_bindings
DROP TABLE IF EXISTS "public"."tool_profile_bindings" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_profile_bindings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "profile_id" uuid NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "priority" integer DEFAULT 100 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tool_profile_bindings_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_profile_entries
DROP TABLE IF EXISTS "public"."tool_profile_entries" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_profile_entries" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "profile_id" uuid NOT NULL,
  "selector_type" text NOT NULL,
  "effect" text DEFAULT 'include'::text NOT NULL,
  "application_id" uuid,
  "connection_id" uuid,
  "catalog_entry_id" uuid,
  "tool_name" text,
  "risk_level" text,
  "conditions" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tool_profile_entries_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_profiles
DROP TABLE IF EXISTS "public"."tool_profiles" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_profiles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "profile_key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'active'::text NOT NULL,
  "default_action" text DEFAULT 'deny'::text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "new_tools_reviewed_at" timestamp with time zone,
  CONSTRAINT "tool_profiles_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_rate_limit_counters
DROP TABLE IF EXISTS "public"."tool_rate_limit_counters" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_rate_limit_counters" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "policy_id" uuid NOT NULL,
  "counter_key" text NOT NULL,
  "scope_type" text NOT NULL,
  "scope_id" text NOT NULL,
  "window_kind" text NOT NULL,
  "window_start_at" timestamp with time zone NOT NULL,
  "limit" integer NOT NULL,
  "remaining" integer NOT NULL,
  "reset_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tool_rate_limit_counters_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_runtime_metric_counters
DROP TABLE IF EXISTS "public"."tool_runtime_metric_counters" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_runtime_metric_counters" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "metric" text NOT NULL,
  "bucket_start_at" timestamp with time zone NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tool_runtime_metric_counters_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_runtime_slots
DROP TABLE IF EXISTS "public"."tool_runtime_slots" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_runtime_slots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "connection_id" uuid,
  "slot_key" text NOT NULL,
  "status" text DEFAULT 'stopped'::text NOT NULL,
  "provider_ref" text,
  "health_status" text DEFAULT 'unchecked'::text NOT NULL,
  "health_message" text,
  "last_started_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "idle_deadline_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "application_id" uuid,
  "project_workspace_id" uuid,
  "execution_workspace_id" uuid,
  "issue_id" uuid,
  "owner_scope_type" text DEFAULT 'connection'::text NOT NULL,
  "owner_scope_id" text,
  "runtime_kind" text DEFAULT 'local_stdio'::text NOT NULL,
  "reuse_key" text,
  "workspace_scope" text,
  "credential_scope_hash" text,
  "provider" text,
  "process_id" integer,
  "command_template_key" text,
  "last_health_check_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "stopped_at" timestamp with time zone,
  "idle_expires_at" timestamp with time zone,
  "last_error" text,
  CONSTRAINT "tool_runtime_slots_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.tool_stdio_command_templates
DROP TABLE IF EXISTS "public"."tool_stdio_command_templates" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."tool_stdio_command_templates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "template_key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'active'::text NOT NULL,
  "command" text NOT NULL,
  "args" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "env_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "disabled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tool_stdio_command_templates_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.user
DROP TABLE IF EXISTS "public"."user" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."user" (
  "id" text NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "email_verified" boolean DEFAULT false NOT NULL,
  "image" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.user_inbox_agent_policies
DROP TABLE IF EXISTS "public"."user_inbox_agent_policies" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."user_inbox_agent_policies" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "mode" text DEFAULT 'open'::text NOT NULL,
  "allowed_agent_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_inbox_agent_policies_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.user_secret_declarations
DROP TABLE IF EXISTS "public"."user_secret_declarations" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."user_secret_declarations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "user_secret_definition_id" uuid NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "config_path" text NOT NULL,
  "env_key" text NOT NULL,
  "version_selector" text DEFAULT 'latest'::text NOT NULL,
  "required" boolean DEFAULT true NOT NULL,
  "allow_missing_override" boolean DEFAULT false NOT NULL,
  "label" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_secret_declarations_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.user_secret_definitions
DROP TABLE IF EXISTS "public"."user_secret_definitions" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."user_secret_definitions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'active'::text NOT NULL,
  "provider" text DEFAULT 'local_encrypted'::text NOT NULL,
  "managed_mode" text DEFAULT 'paperclip_managed'::text NOT NULL,
  "provider_config_id" uuid,
  "provider_metadata" jsonb,
  "usage_guidance" text,
  "created_by_agent_id" uuid,
  "created_by_user_id" text,
  "updated_by_agent_id" uuid,
  "updated_by_user_id" text,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_secret_definitions_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.user_sidebar_preferences
DROP TABLE IF EXISTS "public"."user_sidebar_preferences" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."user_sidebar_preferences" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "company_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_sidebar_preferences_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.verification
DROP TABLE IF EXISTS "public"."verification" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."verification" (
  "id" text NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone,
  CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.workspace_operations
DROP TABLE IF EXISTS "public"."workspace_operations" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."workspace_operations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "execution_workspace_id" uuid,
  "heartbeat_run_id" uuid,
  "phase" text NOT NULL,
  "command" text,
  "cwd" text,
  "status" text DEFAULT 'running'::text NOT NULL,
  "exit_code" integer,
  "log_store" text,
  "log_ref" text,
  "log_bytes" bigint,
  "log_sha256" text,
  "log_compressed" boolean DEFAULT false NOT NULL,
  "stdout_excerpt" text,
  "stderr_excerpt" text,
  "metadata" jsonb,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "issue_id" uuid,
  CONSTRAINT "workspace_operations_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Table: public.workspace_runtime_services
DROP TABLE IF EXISTS "public"."workspace_runtime_services" CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE TABLE "public"."workspace_runtime_services" (
  "id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "project_id" uuid,
  "project_workspace_id" uuid,
  "issue_id" uuid,
  "scope_type" text NOT NULL,
  "scope_id" text,
  "service_name" text NOT NULL,
  "status" text NOT NULL,
  "lifecycle" text NOT NULL,
  "reuse_key" text,
  "command" text,
  "cwd" text,
  "port" integer,
  "url" text,
  "provider" text NOT NULL,
  "provider_ref" text,
  "owner_agent_id" uuid,
  "started_by_run_id" uuid,
  "last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "stopped_at" timestamp with time zone,
  "stop_policy" jsonb,
  "health_status" text DEFAULT 'unknown'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "execution_workspace_id" uuid,
  CONSTRAINT "workspace_runtime_services_pkey" PRIMARY KEY ("id")
);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Sequence ownership
ALTER SEQUENCE "drizzle"."__drizzle_migrations_id_seq" OWNED BY "drizzle"."__drizzle_migrations"."id";
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER SEQUENCE "public"."heartbeat_run_events_id_seq" OWNED BY "public"."heartbeat_run_events"."id";
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Unique constraints
ALTER TABLE "public"."decision_queues" ADD CONSTRAINT "decision_queues_id_company_uq" UNIQUE ("id", "company_id");
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_entities" ADD CONSTRAINT "plugin_entities_external_idx" UNIQUE ("company_id", "plugin_id", "entity_type", "external_id");
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_state" ADD CONSTRAINT "plugin_state_unique_entry_idx" UNIQUE ("plugin_id", "scope_kind", "scope_id", "namespace", "state_key");
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."summary_slots" ADD CONSTRAINT "summary_slots_company_scope_slot_uq" UNIQUE ("company_id", "scope_kind", "scope_id", "slot_key");
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_connections" ADD CONSTRAINT "tool_connections_company_id_uq" UNIQUE ("company_id", "id");
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Foreign keys
ALTER TABLE "public"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."activity_log" ADD CONSTRAINT "activity_log_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."activity_log" ADD CONSTRAINT "activity_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."activity_log" ADD CONSTRAINT "activity_log_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."agent_api_keys" ADD CONSTRAINT "agent_api_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."agent_api_keys" ADD CONSTRAINT "agent_api_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."agent_config_revisions" ADD CONSTRAINT "agent_config_revisions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."agent_config_revisions" ADD CONSTRAINT "agent_config_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."agent_config_revisions" ADD CONSTRAINT "agent_config_revisions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."agent_memberships" ADD CONSTRAINT "agent_memberships_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."agent_memberships" ADD CONSTRAINT "agent_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."agent_runtime_state" ADD CONSTRAINT "agent_runtime_state_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."agent_runtime_state" ADD CONSTRAINT "agent_runtime_state_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."agent_task_sessions" ADD CONSTRAINT "agent_task_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."agent_task_sessions" ADD CONSTRAINT "agent_task_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."agent_task_sessions" ADD CONSTRAINT "agent_task_sessions_last_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."agent_wakeup_requests" ADD CONSTRAINT "agent_wakeup_requests_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."agent_wakeup_requests" ADD CONSTRAINT "agent_wakeup_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."agents" ADD CONSTRAINT "agents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."agents" ADD CONSTRAINT "agents_default_environment_id_environments_id_fk" FOREIGN KEY ("default_environment_id") REFERENCES "public"."environments" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."agents" ADD CONSTRAINT "agents_reports_to_agents_id_fk" FOREIGN KEY ("reports_to") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."approval_comments" ADD CONSTRAINT "approval_comments_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."approval_comments" ADD CONSTRAINT "approval_comments_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."approval_comments" ADD CONSTRAINT "approval_comments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."approvals" ADD CONSTRAINT "approvals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."approvals" ADD CONSTRAINT "approvals_requested_by_agent_id_agents_id_fk" FOREIGN KEY ("requested_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."assets" ADD CONSTRAINT "assets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."assets" ADD CONSTRAINT "assets_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."board_api_keys" ADD CONSTRAINT "board_api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."budget_incidents" ADD CONSTRAINT "budget_incidents_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."budget_incidents" ADD CONSTRAINT "budget_incidents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."budget_incidents" ADD CONSTRAINT "budget_incidents_policy_id_budget_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."budget_policies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."budget_policies" ADD CONSTRAINT "budget_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."built_in_managed_resources" ADD CONSTRAINT "built_in_managed_resources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."case_attachments" ADD CONSTRAINT "case_attachments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."case_attachments" ADD CONSTRAINT "case_attachments_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."case_attachments" ADD CONSTRAINT "case_attachments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."case_documents" ADD CONSTRAINT "case_documents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."case_documents" ADD CONSTRAINT "case_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."case_documents" ADD CONSTRAINT "case_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."case_events" ADD CONSTRAINT "case_events_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."case_events" ADD CONSTRAINT "case_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."case_events" ADD CONSTRAINT "case_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."case_issue_links" ADD CONSTRAINT "case_issue_links_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."case_issue_links" ADD CONSTRAINT "case_issue_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."case_issue_links" ADD CONSTRAINT "case_issue_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."case_labels" ADD CONSTRAINT "case_labels_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."case_labels" ADD CONSTRAINT "case_labels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."case_labels" ADD CONSTRAINT "case_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."cases" ADD CONSTRAINT "cases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."cases" ADD CONSTRAINT "cases_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."cases" ADD CONSTRAINT "cases_parent_case_id_cases_id_fk" FOREIGN KEY ("parent_case_id") REFERENCES "public"."cases" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."cases" ADD CONSTRAINT "cases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."cli_auth_challenges" ADD CONSTRAINT "cli_auth_challenges_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."cli_auth_challenges" ADD CONSTRAINT "cli_auth_challenges_board_api_key_id_board_api_keys_id_fk" FOREIGN KEY ("board_api_key_id") REFERENCES "public"."board_api_keys" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."cli_auth_challenges" ADD CONSTRAINT "cli_auth_challenges_requested_company_id_companies_id_fk" FOREIGN KEY ("requested_company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_logos" ADD CONSTRAINT "company_logos_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_logos" ADD CONSTRAINT "company_logos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_memberships" ADD CONSTRAINT "company_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_secret_bindings" ADD CONSTRAINT "company_secret_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_secret_bindings" ADD CONSTRAINT "company_secret_bindings_secret_id_company_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."company_secrets" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_secret_proposals" ADD CONSTRAINT "company_secret_proposals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_secret_proposals" ADD CONSTRAINT "company_secret_proposals_created_secret_id_company_secrets_id_f" FOREIGN KEY ("created_secret_id") REFERENCES "public"."company_secrets" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_secret_proposals" ADD CONSTRAINT "company_secret_proposals_origin_issue_id_issues_id_fk" FOREIGN KEY ("origin_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_secret_proposals" ADD CONSTRAINT "company_secret_proposals_origin_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("origin_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_secret_proposals" ADD CONSTRAINT "company_secret_proposals_proposed_by_agent_id_agents_id_fk" FOREIGN KEY ("proposed_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_secret_proposals" ADD CONSTRAINT "company_secret_proposals_secret_id_company_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."company_secrets" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_secret_proposals" ADD CONSTRAINT "company_secret_proposals_secret_proposal_id_company_secret_prop" FOREIGN KEY ("secret_proposal_id") REFERENCES "public"."company_secret_proposals" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_secret_proposals" ADD CONSTRAINT "company_secret_proposals_target_id_agents_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_secret_provider_configs" ADD CONSTRAINT "company_secret_provider_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_secret_provider_configs" ADD CONSTRAINT "company_secret_provider_configs_created_by_agent_id_agents_id_f" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_secret_versions" ADD CONSTRAINT "company_secret_versions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_secret_versions" ADD CONSTRAINT "company_secret_versions_secret_id_company_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."company_secrets" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_secrets" ADD CONSTRAINT "company_secrets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_secrets" ADD CONSTRAINT "company_secrets_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_secrets" ADD CONSTRAINT "company_secrets_provider_config_id_company_secret_provider_conf" FOREIGN KEY ("provider_config_id") REFERENCES "public"."company_secret_provider_configs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_secrets" ADD CONSTRAINT "company_secrets_user_secret_definition_id_user_secret_definitio" FOREIGN KEY ("user_secret_definition_id") REFERENCES "public"."user_secret_definitions" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_comments" ADD CONSTRAINT "company_skill_comments_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_comments" ADD CONSTRAINT "company_skill_comments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_comments" ADD CONSTRAINT "company_skill_comments_company_skill_id_company_skills_id_fk" FOREIGN KEY ("company_skill_id") REFERENCES "public"."company_skills" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_comments" ADD CONSTRAINT "company_skill_comments_parent_comment_id_company_skill_comments" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."company_skill_comments" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_policies" ADD CONSTRAINT "company_skill_policies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_stars" ADD CONSTRAINT "company_skill_stars_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_stars" ADD CONSTRAINT "company_skill_stars_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_stars" ADD CONSTRAINT "company_skill_stars_company_skill_id_company_skills_id_fk" FOREIGN KEY ("company_skill_id") REFERENCES "public"."company_skills" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_test_inputs" ADD CONSTRAINT "company_skill_test_inputs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_test_inputs" ADD CONSTRAINT "company_skill_test_inputs_skill_id_company_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."company_skills" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_test_run_templates" ADD CONSTRAINT "company_skill_test_run_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_test_run_templates" ADD CONSTRAINT "company_skill_test_run_templates_created_by_agent_id_agents_id_" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_test_run_templates" ADD CONSTRAINT "company_skill_test_run_templates_updated_by_agent_id_agents_id_" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_test_runs" ADD CONSTRAINT "company_skill_test_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_test_runs" ADD CONSTRAINT "company_skill_test_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_test_runs" ADD CONSTRAINT "company_skill_test_runs_input_id_company_skill_test_inputs_id_f" FOREIGN KEY ("input_id") REFERENCES "public"."company_skill_test_inputs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_test_runs" ADD CONSTRAINT "company_skill_test_runs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_test_runs" ADD CONSTRAINT "company_skill_test_runs_skill_id_company_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."company_skills" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_test_runs" ADD CONSTRAINT "company_skill_test_runs_skill_version_id_company_skill_versions" FOREIGN KEY ("skill_version_id") REFERENCES "public"."company_skill_versions" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_versions" ADD CONSTRAINT "company_skill_versions_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_versions" ADD CONSTRAINT "company_skill_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skill_versions" ADD CONSTRAINT "company_skill_versions_company_skill_id_company_skills_id_fk" FOREIGN KEY ("company_skill_id") REFERENCES "public"."company_skills" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skills" ADD CONSTRAINT "company_skills_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skills" ADD CONSTRAINT "company_skills_current_version_id_company_skill_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."company_skill_versions" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skills" ADD CONSTRAINT "company_skills_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skills" ADD CONSTRAINT "company_skills_forked_from_company_id_companies_id_fk" FOREIGN KEY ("forked_from_company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_skills" ADD CONSTRAINT "company_skills_forked_from_skill_id_company_skills_id_fk" FOREIGN KEY ("forked_from_skill_id") REFERENCES "public"."company_skills" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."company_user_sidebar_preferences" ADD CONSTRAINT "company_user_sidebar_preferences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."connection_grants" ADD CONSTRAINT "connection_grants_company_connection_fk" FOREIGN KEY ("company_id", "connection_id") REFERENCES "public"."tool_connections" ("company_id", "id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."connection_grants" ADD CONSTRAINT "connection_grants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."connection_grants" ADD CONSTRAINT "connection_grants_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."connection_grants" ADD CONSTRAINT "connection_grants_revoked_by_agent_id_agents_id_fk" FOREIGN KEY ("revoked_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."connection_token_issuances" ADD CONSTRAINT "connection_token_issuances_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."connection_token_issuances" ADD CONSTRAINT "connection_token_issuances_application_id_tool_applications_id_" FOREIGN KEY ("application_id") REFERENCES "public"."tool_applications" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."connection_token_issuances" ADD CONSTRAINT "connection_token_issuances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."connection_token_issuances" ADD CONSTRAINT "connection_token_issuances_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."connection_token_issuances" ADD CONSTRAINT "connection_token_issuances_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."connection_token_issuances" ADD CONSTRAINT "connection_token_issuances_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."connection_token_issuances" ADD CONSTRAINT "connection_token_issuances_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."cost_events" ADD CONSTRAINT "cost_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."cost_events" ADD CONSTRAINT "cost_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."cost_events" ADD CONSTRAINT "cost_events_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."cost_events" ADD CONSTRAINT "cost_events_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."cost_events" ADD CONSTRAINT "cost_events_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."cost_events" ADD CONSTRAINT "cost_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_archive_notification_outbox" ADD CONSTRAINT "decision_archive_notification_outbox_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_archive_notification_outbox" ADD CONSTRAINT "decision_archive_notification_outbox_origin_agent_id_agents_id_" FOREIGN KEY ("origin_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_bundles" ADD CONSTRAINT "decision_bundles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_bundles" ADD CONSTRAINT "decision_bundles_origin_agent_id_agents_id_fk" FOREIGN KEY ("origin_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_bundles" ADD CONSTRAINT "decision_bundles_origin_issue_id_issues_id_fk" FOREIGN KEY ("origin_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_bundles" ADD CONSTRAINT "decision_bundles_origin_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("origin_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_effect_executions" ADD CONSTRAINT "decision_effect_executions_activity_log_id_activity_log_id_fk" FOREIGN KEY ("activity_log_id") REFERENCES "public"."activity_log" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_effect_executions" ADD CONSTRAINT "decision_effect_executions_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_effect_executions" ADD CONSTRAINT "decision_effect_executions_target_issue_id_issues_id_fk" FOREIGN KEY ("target_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_queue_items" ADD CONSTRAINT "decision_queue_items_added_by_agent_api_key_id_agent_api_keys_i" FOREIGN KEY ("added_by_agent_api_key_id") REFERENCES "public"."agent_api_keys" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_queue_items" ADD CONSTRAINT "decision_queue_items_added_by_agent_id_agents_id_fk" FOREIGN KEY ("added_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_queue_items" ADD CONSTRAINT "decision_queue_items_added_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("added_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_queue_items" ADD CONSTRAINT "decision_queue_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_queue_items" ADD CONSTRAINT "decision_queue_items_queue_company_fk" FOREIGN KEY ("queue_id", "company_id") REFERENCES "public"."decision_queues" ("id", "company_id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_queues" ADD CONSTRAINT "decision_queues_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_queues" ADD CONSTRAINT "decision_queues_created_by_agent_api_key_id_agent_api_keys_id_f" FOREIGN KEY ("created_by_agent_api_key_id") REFERENCES "public"."agent_api_keys" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_queues" ADD CONSTRAINT "decision_queues_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_queues" ADD CONSTRAINT "decision_queues_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_retention" ADD CONSTRAINT "decision_retention_archived_by_agent_id_agents_id_fk" FOREIGN KEY ("archived_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_retention" ADD CONSTRAINT "decision_retention_archived_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("archived_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_retention" ADD CONSTRAINT "decision_retention_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_target_issues" ADD CONSTRAINT "decision_target_issues_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_target_issues" ADD CONSTRAINT "decision_target_issues_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_target_issues" ADD CONSTRAINT "decision_target_issues_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_training_examples" ADD CONSTRAINT "decision_training_examples_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_training_examples" ADD CONSTRAINT "decision_training_examples_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_triage" ADD CONSTRAINT "decision_triage_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_triage" ADD CONSTRAINT "decision_triage_set_by_agent_api_key_id_agent_api_keys_id_fk" FOREIGN KEY ("set_by_agent_api_key_id") REFERENCES "public"."agent_api_keys" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_triage" ADD CONSTRAINT "decision_triage_set_by_agent_id_agents_id_fk" FOREIGN KEY ("set_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_triage" ADD CONSTRAINT "decision_triage_set_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("set_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_triage_events" ADD CONSTRAINT "decision_triage_events_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_triage_events" ADD CONSTRAINT "decision_triage_events_actor_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("actor_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_triage_events" ADD CONSTRAINT "decision_triage_events_agent_api_key_id_agent_api_keys_id_fk" FOREIGN KEY ("agent_api_key_id") REFERENCES "public"."agent_api_keys" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_triage_events" ADD CONSTRAINT "decision_triage_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decision_triage_events" ADD CONSTRAINT "decision_triage_events_queue_id_decision_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."decision_queues" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decisions" ADD CONSTRAINT "decisions_bundle_id_decision_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."decision_bundles" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decisions" ADD CONSTRAINT "decisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decisions" ADD CONSTRAINT "decisions_origin_agent_id_agents_id_fk" FOREIGN KEY ("origin_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decisions" ADD CONSTRAINT "decisions_origin_issue_id_issues_id_fk" FOREIGN KEY ("origin_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."decisions" ADD CONSTRAINT "decisions_origin_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("origin_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_anchor_snapshots" ADD CONSTRAINT "document_annotation_anchor_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_anchor_snapshots" ADD CONSTRAINT "document_annotation_anchor_snapshots_document_id_documents_id_f" FOREIGN KEY ("document_id") REFERENCES "public"."documents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_anchor_snapshots" ADD CONSTRAINT "document_annotation_anchor_snapshots_from_revision_id_document_" FOREIGN KEY ("from_revision_id") REFERENCES "public"."document_revisions" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_anchor_snapshots" ADD CONSTRAINT "document_annotation_anchor_snapshots_thread_id_document_annotat" FOREIGN KEY ("thread_id") REFERENCES "public"."document_annotation_threads" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_anchor_snapshots" ADD CONSTRAINT "document_annotation_anchor_snapshots_to_revision_id_document_re" FOREIGN KEY ("to_revision_id") REFERENCES "public"."document_revisions" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_created_by_run_id_heartbeat_runs_i" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_issue_comment_id_issue_comments_id" FOREIGN KEY ("issue_comment_id") REFERENCES "public"."issue_comments" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_thread_id_document_annotation_thre" FOREIGN KEY ("thread_id") REFERENCES "public"."document_annotation_threads" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_threads" ADD CONSTRAINT "document_annotation_threads_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_threads" ADD CONSTRAINT "document_annotation_threads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_threads" ADD CONSTRAINT "document_annotation_threads_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_threads" ADD CONSTRAINT "document_annotation_threads_current_revision_id_document_revisi" FOREIGN KEY ("current_revision_id") REFERENCES "public"."document_revisions" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_threads" ADD CONSTRAINT "document_annotation_threads_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_threads" ADD CONSTRAINT "document_annotation_threads_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_threads" ADD CONSTRAINT "document_annotation_threads_original_revision_id_document_revis" FOREIGN KEY ("original_revision_id") REFERENCES "public"."document_revisions" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_threads" ADD CONSTRAINT "document_annotation_threads_resolved_by_agent_id_agents_id_fk" FOREIGN KEY ("resolved_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_annotation_threads" ADD CONSTRAINT "document_annotation_threads_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_memberships" ADD CONSTRAINT "document_memberships_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_memberships" ADD CONSTRAINT "document_memberships_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_revisions" ADD CONSTRAINT "document_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_revisions" ADD CONSTRAINT "document_revisions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_revisions" ADD CONSTRAINT "document_revisions_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."document_revisions" ADD CONSTRAINT "document_revisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_locked_by_agent_id_agents_id_fk" FOREIGN KEY ("locked_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."environment_custom_image_setup_sessions" ADD CONSTRAINT "environment_custom_image_setup_sessions_environment_id_environm" FOREIGN KEY ("environment_id") REFERENCES "public"."environments" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."environment_custom_image_setup_sessions" ADD CONSTRAINT "environment_custom_image_setup_sessions_environment_lease_id_en" FOREIGN KEY ("environment_lease_id") REFERENCES "public"."environment_leases" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."environment_custom_image_setup_sessions" ADD CONSTRAINT "environment_custom_image_setup_sessions_promoted_template_id_fk" FOREIGN KEY ("promoted_template_id") REFERENCES "public"."environment_custom_image_templates" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."environment_custom_image_setup_sessions" ADD CONSTRAINT "environment_custom_image_setup_sessions_started_by_agent_id_age" FOREIGN KEY ("started_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."environment_custom_image_setup_sessions" ADD CONSTRAINT "environment_custom_image_setup_sessions_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."environment_custom_image_templates" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."environment_custom_image_templates" ADD CONSTRAINT "environment_custom_image_templates_created_by_agent_id_agents_i" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."environment_custom_image_templates" ADD CONSTRAINT "environment_custom_image_templates_environment_id_environments_" FOREIGN KEY ("environment_id") REFERENCES "public"."environments" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."environment_custom_image_templates" ADD CONSTRAINT "environment_custom_image_templates_superseded_by_template_id_fk" FOREIGN KEY ("superseded_by_template_id") REFERENCES "public"."environment_custom_image_templates" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."environment_leases" ADD CONSTRAINT "environment_leases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."environment_leases" ADD CONSTRAINT "environment_leases_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."environment_leases" ADD CONSTRAINT "environment_leases_execution_workspace_id_execution_workspaces_" FOREIGN KEY ("execution_workspace_id") REFERENCES "public"."execution_workspaces" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."environment_leases" ADD CONSTRAINT "environment_leases_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."environment_leases" ADD CONSTRAINT "environment_leases_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."execution_workspaces" ADD CONSTRAINT "execution_workspaces_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."execution_workspaces" ADD CONSTRAINT "execution_workspaces_derived_from_execution_workspace_id_execut" FOREIGN KEY ("derived_from_execution_workspace_id") REFERENCES "public"."execution_workspaces" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."execution_workspaces" ADD CONSTRAINT "execution_workspaces_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."execution_workspaces" ADD CONSTRAINT "execution_workspaces_project_workspace_id_project_workspaces_id" FOREIGN KEY ("project_workspace_id") REFERENCES "public"."project_workspaces" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."execution_workspaces" ADD CONSTRAINT "execution_workspaces_source_issue_id_issues_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."external_object_mentions" ADD CONSTRAINT "external_object_mentions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."external_object_mentions" ADD CONSTRAINT "external_object_mentions_created_by_plugin_id_plugins_id_fk" FOREIGN KEY ("created_by_plugin_id") REFERENCES "public"."plugins" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."external_object_mentions" ADD CONSTRAINT "external_object_mentions_object_id_external_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."external_objects" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."external_object_mentions" ADD CONSTRAINT "external_object_mentions_source_issue_id_issues_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."external_objects" ADD CONSTRAINT "external_objects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."external_objects" ADD CONSTRAINT "external_objects_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."feedback_exports" ADD CONSTRAINT "feedback_exports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."feedback_exports" ADD CONSTRAINT "feedback_exports_feedback_vote_id_feedback_votes_id_fk" FOREIGN KEY ("feedback_vote_id") REFERENCES "public"."feedback_votes" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."feedback_exports" ADD CONSTRAINT "feedback_exports_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."feedback_exports" ADD CONSTRAINT "feedback_exports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."feedback_votes" ADD CONSTRAINT "feedback_votes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."feedback_votes" ADD CONSTRAINT "feedback_votes_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."finance_events" ADD CONSTRAINT "finance_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."finance_events" ADD CONSTRAINT "finance_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."finance_events" ADD CONSTRAINT "finance_events_cost_event_id_cost_events_id_fk" FOREIGN KEY ("cost_event_id") REFERENCES "public"."cost_events" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."finance_events" ADD CONSTRAINT "finance_events_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."finance_events" ADD CONSTRAINT "finance_events_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."finance_events" ADD CONSTRAINT "finance_events_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."finance_events" ADD CONSTRAINT "finance_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."folders" ADD CONSTRAINT "folders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."goals" ADD CONSTRAINT "goals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."goals" ADD CONSTRAINT "goals_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."goals" ADD CONSTRAINT "goals_parent_id_goals_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."goals" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."heartbeat_run_events" ADD CONSTRAINT "heartbeat_run_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."heartbeat_run_events" ADD CONSTRAINT "heartbeat_run_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."heartbeat_run_events" ADD CONSTRAINT "heartbeat_run_events_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."heartbeat_run_watchdog_decisions" ADD CONSTRAINT "heartbeat_run_watchdog_decisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."heartbeat_run_watchdog_decisions" ADD CONSTRAINT "heartbeat_run_watchdog_decisions_created_by_agent_id_agents_id_" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."heartbeat_run_watchdog_decisions" ADD CONSTRAINT "heartbeat_run_watchdog_decisions_created_by_run_id_heartbeat_ru" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."heartbeat_run_watchdog_decisions" ADD CONSTRAINT "heartbeat_run_watchdog_decisions_evaluation_issue_id_issues_id_" FOREIGN KEY ("evaluation_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."heartbeat_run_watchdog_decisions" ADD CONSTRAINT "heartbeat_run_watchdog_decisions_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_retry_of_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("retry_of_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_wakeup_request_id_agent_wakeup_requests_id_fk" FOREIGN KEY ("wakeup_request_id") REFERENCES "public"."agent_wakeup_requests" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."inbox_dismissals" ADD CONSTRAINT "inbox_dismissals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."instance_settings" ADD CONSTRAINT "instance_settings_default_environment_id_environments_id_fk" FOREIGN KEY ("default_environment_id") REFERENCES "public"."environments" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."invites" ADD CONSTRAINT "invites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_approvals" ADD CONSTRAINT "issue_approvals_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_approvals" ADD CONSTRAINT "issue_approvals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_approvals" ADD CONSTRAINT "issue_approvals_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_approvals" ADD CONSTRAINT "issue_approvals_linked_by_agent_id_agents_id_fk" FOREIGN KEY ("linked_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_attachments" ADD CONSTRAINT "issue_attachments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_attachments" ADD CONSTRAINT "issue_attachments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_attachments" ADD CONSTRAINT "issue_attachments_issue_comment_id_issue_comments_id_fk" FOREIGN KEY ("issue_comment_id") REFERENCES "public"."issue_comments" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_attachments" ADD CONSTRAINT "issue_attachments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_comments" ADD CONSTRAINT "issue_comments_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_comments" ADD CONSTRAINT "issue_comments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_comments" ADD CONSTRAINT "issue_comments_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_comments" ADD CONSTRAINT "issue_comments_deleted_by_agent_id_agents_id_fk" FOREIGN KEY ("deleted_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_comments" ADD CONSTRAINT "issue_comments_deleted_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("deleted_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_comments" ADD CONSTRAINT "issue_comments_derived_author_agent_id_agents_id_fk" FOREIGN KEY ("derived_author_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_comments" ADD CONSTRAINT "issue_comments_derived_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("derived_created_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_comments" ADD CONSTRAINT "issue_comments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_comments" ADD CONSTRAINT "issue_comments_on_behalf_of_user_id_user_id_fk" FOREIGN KEY ("on_behalf_of_user_id") REFERENCES "public"."user" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_create_idempotency_keys" ADD CONSTRAINT "issue_create_idempotency_keys_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_create_idempotency_keys" ADD CONSTRAINT "issue_create_idempotency_keys_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_documents" ADD CONSTRAINT "issue_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_documents" ADD CONSTRAINT "issue_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_documents" ADD CONSTRAINT "issue_documents_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_execution_decisions" ADD CONSTRAINT "issue_execution_decisions_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_execution_decisions" ADD CONSTRAINT "issue_execution_decisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_execution_decisions" ADD CONSTRAINT "issue_execution_decisions_created_by_run_id_heartbeat_runs_id_f" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_execution_decisions" ADD CONSTRAINT "issue_execution_decisions_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_inbox_archives" ADD CONSTRAINT "issue_inbox_archives_archived_by_agent_id_agents_id_fk" FOREIGN KEY ("archived_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_inbox_archives" ADD CONSTRAINT "issue_inbox_archives_archived_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("archived_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_inbox_archives" ADD CONSTRAINT "issue_inbox_archives_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_inbox_archives" ADD CONSTRAINT "issue_inbox_archives_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_labels" ADD CONSTRAINT "issue_labels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_labels" ADD CONSTRAINT "issue_labels_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_labels" ADD CONSTRAINT "issue_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_plan_decompositions" ADD CONSTRAINT "issue_plan_decompositions_accepted_interaction_id_issue_thread_" FOREIGN KEY ("accepted_interaction_id") REFERENCES "public"."issue_thread_interactions" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_plan_decompositions" ADD CONSTRAINT "issue_plan_decompositions_accepted_plan_revision_id_document_re" FOREIGN KEY ("accepted_plan_revision_id") REFERENCES "public"."document_revisions" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_plan_decompositions" ADD CONSTRAINT "issue_plan_decompositions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_plan_decompositions" ADD CONSTRAINT "issue_plan_decompositions_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_plan_decompositions" ADD CONSTRAINT "issue_plan_decompositions_owner_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("owner_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_plan_decompositions" ADD CONSTRAINT "issue_plan_decompositions_source_issue_id_issues_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_read_states" ADD CONSTRAINT "issue_read_states_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_read_states" ADD CONSTRAINT "issue_read_states_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_recovery_actions" ADD CONSTRAINT "issue_recovery_actions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_recovery_actions" ADD CONSTRAINT "issue_recovery_actions_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_recovery_actions" ADD CONSTRAINT "issue_recovery_actions_previous_owner_agent_id_agents_id_fk" FOREIGN KEY ("previous_owner_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_recovery_actions" ADD CONSTRAINT "issue_recovery_actions_recovery_issue_id_issues_id_fk" FOREIGN KEY ("recovery_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_recovery_actions" ADD CONSTRAINT "issue_recovery_actions_return_owner_agent_id_agents_id_fk" FOREIGN KEY ("return_owner_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_recovery_actions" ADD CONSTRAINT "issue_recovery_actions_source_issue_id_issues_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_reference_mentions" ADD CONSTRAINT "issue_reference_mentions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_reference_mentions" ADD CONSTRAINT "issue_reference_mentions_source_issue_id_issues_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_reference_mentions" ADD CONSTRAINT "issue_reference_mentions_target_issue_id_issues_id_fk" FOREIGN KEY ("target_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_relations" ADD CONSTRAINT "issue_relations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_relations" ADD CONSTRAINT "issue_relations_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_relations" ADD CONSTRAINT "issue_relations_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_relations" ADD CONSTRAINT "issue_relations_related_issue_id_issues_id_fk" FOREIGN KEY ("related_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_addressee_agent_id_agents_id_fk" FOREIGN KEY ("addressee_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_resolved_by_agent_id_agents_id_fk" FOREIGN KEY ("resolved_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_resolved_by_run_id_heartbeat_runs_id_" FOREIGN KEY ("resolved_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_source_comment_id_issue_comments_id_f" FOREIGN KEY ("source_comment_id") REFERENCES "public"."issue_comments" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_thread_interactions" ADD CONSTRAINT "issue_thread_interactions_source_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_tree_hold_members" ADD CONSTRAINT "issue_tree_hold_members_active_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("active_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_tree_hold_members" ADD CONSTRAINT "issue_tree_hold_members_assignee_agent_id_agents_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_tree_hold_members" ADD CONSTRAINT "issue_tree_hold_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_tree_hold_members" ADD CONSTRAINT "issue_tree_hold_members_hold_id_issue_tree_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."issue_tree_holds" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_tree_hold_members" ADD CONSTRAINT "issue_tree_hold_members_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_tree_hold_members" ADD CONSTRAINT "issue_tree_hold_members_parent_issue_id_issues_id_fk" FOREIGN KEY ("parent_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_tree_holds" ADD CONSTRAINT "issue_tree_holds_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_tree_holds" ADD CONSTRAINT "issue_tree_holds_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_tree_holds" ADD CONSTRAINT "issue_tree_holds_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_tree_holds" ADD CONSTRAINT "issue_tree_holds_released_by_agent_id_agents_id_fk" FOREIGN KEY ("released_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_tree_holds" ADD CONSTRAINT "issue_tree_holds_released_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("released_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_tree_holds" ADD CONSTRAINT "issue_tree_holds_root_issue_id_issues_id_fk" FOREIGN KEY ("root_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_watchdogs" ADD CONSTRAINT "issue_watchdogs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_watchdogs" ADD CONSTRAINT "issue_watchdogs_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_watchdogs" ADD CONSTRAINT "issue_watchdogs_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_watchdogs" ADD CONSTRAINT "issue_watchdogs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_watchdogs" ADD CONSTRAINT "issue_watchdogs_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_watchdogs" ADD CONSTRAINT "issue_watchdogs_updated_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("updated_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_watchdogs" ADD CONSTRAINT "issue_watchdogs_watchdog_agent_id_agents_id_fk" FOREIGN KEY ("watchdog_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_watchdogs" ADD CONSTRAINT "issue_watchdogs_watchdog_issue_id_issues_id_fk" FOREIGN KEY ("watchdog_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_work_products" ADD CONSTRAINT "issue_work_products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_work_products" ADD CONSTRAINT "issue_work_products_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_work_products" ADD CONSTRAINT "issue_work_products_execution_workspace_id_execution_workspaces" FOREIGN KEY ("execution_workspace_id") REFERENCES "public"."execution_workspaces" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_work_products" ADD CONSTRAINT "issue_work_products_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_work_products" ADD CONSTRAINT "issue_work_products_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issue_work_products" ADD CONSTRAINT "issue_work_products_runtime_service_id_workspace_runtime_servic" FOREIGN KEY ("runtime_service_id") REFERENCES "public"."workspace_runtime_services" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issues" ADD CONSTRAINT "issues_assignee_agent_id_agents_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issues" ADD CONSTRAINT "issues_checkout_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("checkout_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issues" ADD CONSTRAINT "issues_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issues" ADD CONSTRAINT "issues_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issues" ADD CONSTRAINT "issues_execution_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("execution_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issues" ADD CONSTRAINT "issues_execution_workspace_id_execution_workspaces_id_fk" FOREIGN KEY ("execution_workspace_id") REFERENCES "public"."execution_workspaces" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issues" ADD CONSTRAINT "issues_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issues" ADD CONSTRAINT "issues_parent_id_issues_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issues" ADD CONSTRAINT "issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."issues" ADD CONSTRAINT "issues_project_workspace_id_project_workspaces_id_fk" FOREIGN KEY ("project_workspace_id") REFERENCES "public"."project_workspaces" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."join_requests" ADD CONSTRAINT "join_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."join_requests" ADD CONSTRAINT "join_requests_created_agent_id_agents_id_fk" FOREIGN KEY ("created_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."join_requests" ADD CONSTRAINT "join_requests_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."labels" ADD CONSTRAINT "labels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_automation_executions" ADD CONSTRAINT "pipeline_automation_executions_case_id_pipeline_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."pipeline_cases" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_automation_executions" ADD CONSTRAINT "pipeline_automation_executions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_automation_executions" ADD CONSTRAINT "pipeline_automation_executions_execution_issue_id_issues_id_fk" FOREIGN KEY ("execution_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_automation_executions" ADD CONSTRAINT "pipeline_automation_executions_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_case_blockers" ADD CONSTRAINT "pipeline_case_blockers_blocked_by_case_id_pipeline_cases_id_fk" FOREIGN KEY ("blocked_by_case_id") REFERENCES "public"."pipeline_cases" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_case_blockers" ADD CONSTRAINT "pipeline_case_blockers_case_id_pipeline_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."pipeline_cases" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_case_blockers" ADD CONSTRAINT "pipeline_case_blockers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_case_documents" ADD CONSTRAINT "pipeline_case_documents_case_id_pipeline_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."pipeline_cases" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_case_documents" ADD CONSTRAINT "pipeline_case_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_case_documents" ADD CONSTRAINT "pipeline_case_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_case_events" ADD CONSTRAINT "pipeline_case_events_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_case_events" ADD CONSTRAINT "pipeline_case_events_case_id_pipeline_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."pipeline_cases" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_case_events" ADD CONSTRAINT "pipeline_case_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_case_events" ADD CONSTRAINT "pipeline_case_events_from_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."pipeline_stages" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_case_events" ADD CONSTRAINT "pipeline_case_events_to_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."pipeline_stages" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_case_issue_links" ADD CONSTRAINT "pipeline_case_issue_links_case_id_pipeline_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."pipeline_cases" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_case_issue_links" ADD CONSTRAINT "pipeline_case_issue_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_case_issue_links" ADD CONSTRAINT "pipeline_case_issue_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_cases" ADD CONSTRAINT "pipeline_cases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_cases" ADD CONSTRAINT "pipeline_cases_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_cases" ADD CONSTRAINT "pipeline_cases_lease_agent_id_agents_id_fk" FOREIGN KEY ("lease_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_cases" ADD CONSTRAINT "pipeline_cases_parent_case_id_pipeline_cases_id_fk" FOREIGN KEY ("parent_case_id") REFERENCES "public"."pipeline_cases" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_cases" ADD CONSTRAINT "pipeline_cases_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_cases" ADD CONSTRAINT "pipeline_cases_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_documents" ADD CONSTRAINT "pipeline_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_documents" ADD CONSTRAINT "pipeline_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_documents" ADD CONSTRAINT "pipeline_documents_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_transitions" ADD CONSTRAINT "pipeline_transitions_from_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."pipeline_stages" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_transitions" ADD CONSTRAINT "pipeline_transitions_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipeline_transitions" ADD CONSTRAINT "pipeline_transitions_to_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."pipeline_stages" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipelines" ADD CONSTRAINT "pipelines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipelines" ADD CONSTRAINT "pipelines_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."pipelines" ADD CONSTRAINT "pipelines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_company_settings" ADD CONSTRAINT "plugin_company_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_company_settings" ADD CONSTRAINT "plugin_company_settings_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_config" ADD CONSTRAINT "plugin_config_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_config" ADD CONSTRAINT "plugin_config_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_database_namespaces" ADD CONSTRAINT "plugin_database_namespaces_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_entities" ADD CONSTRAINT "plugin_entities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_entities" ADD CONSTRAINT "plugin_entities_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_job_runs" ADD CONSTRAINT "plugin_job_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_job_runs" ADD CONSTRAINT "plugin_job_runs_job_id_plugin_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."plugin_jobs" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_job_runs" ADD CONSTRAINT "plugin_job_runs_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_jobs" ADD CONSTRAINT "plugin_jobs_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_logs" ADD CONSTRAINT "plugin_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_logs" ADD CONSTRAINT "plugin_logs_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_managed_resources" ADD CONSTRAINT "plugin_managed_resources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_managed_resources" ADD CONSTRAINT "plugin_managed_resources_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_migrations" ADD CONSTRAINT "plugin_migrations_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_state" ADD CONSTRAINT "plugin_state_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_webhook_deliveries" ADD CONSTRAINT "plugin_webhook_deliveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."plugin_webhook_deliveries" ADD CONSTRAINT "plugin_webhook_deliveries_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."principal_permission_grants" ADD CONSTRAINT "principal_permission_grants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."project_goals" ADD CONSTRAINT "project_goals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."project_goals" ADD CONSTRAINT "project_goals_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."project_goals" ADD CONSTRAINT "project_goals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."project_memberships" ADD CONSTRAINT "project_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."project_memberships" ADD CONSTRAINT "project_memberships_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."project_workspaces" ADD CONSTRAINT "project_workspaces_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."project_workspaces" ADD CONSTRAINT "project_workspaces_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."projects" ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."projects" ADD CONSTRAINT "projects_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."projects" ADD CONSTRAINT "projects_lead_agent_id_agents_id_fk" FOREIGN KEY ("lead_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routine_documents" ADD CONSTRAINT "routine_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routine_documents" ADD CONSTRAINT "routine_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routine_documents" ADD CONSTRAINT "routine_documents_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routine_revisions" ADD CONSTRAINT "routine_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routine_revisions" ADD CONSTRAINT "routine_revisions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routine_revisions" ADD CONSTRAINT "routine_revisions_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routine_revisions" ADD CONSTRAINT "routine_revisions_restored_from_revision_id_routine_revisions_i" FOREIGN KEY ("restored_from_revision_id") REFERENCES "public"."routine_revisions" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routine_revisions" ADD CONSTRAINT "routine_revisions_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routine_runs" ADD CONSTRAINT "routine_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routine_runs" ADD CONSTRAINT "routine_runs_linked_issue_id_issues_id_fk" FOREIGN KEY ("linked_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routine_runs" ADD CONSTRAINT "routine_runs_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routine_runs" ADD CONSTRAINT "routine_runs_routine_revision_id_routine_revisions_id_fk" FOREIGN KEY ("routine_revision_id") REFERENCES "public"."routine_revisions" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routine_runs" ADD CONSTRAINT "routine_runs_trigger_id_routine_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."routine_triggers" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routine_triggers" ADD CONSTRAINT "routine_triggers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routine_triggers" ADD CONSTRAINT "routine_triggers_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routine_triggers" ADD CONSTRAINT "routine_triggers_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routine_triggers" ADD CONSTRAINT "routine_triggers_secret_id_company_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."company_secrets" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routine_triggers" ADD CONSTRAINT "routine_triggers_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routines" ADD CONSTRAINT "routines_assignee_agent_id_agents_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routines" ADD CONSTRAINT "routines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routines" ADD CONSTRAINT "routines_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routines" ADD CONSTRAINT "routines_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routines" ADD CONSTRAINT "routines_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routines" ADD CONSTRAINT "routines_parent_issue_id_issues_id_fk" FOREIGN KEY ("parent_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routines" ADD CONSTRAINT "routines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."routines" ADD CONSTRAINT "routines_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."secret_access_events" ADD CONSTRAINT "secret_access_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."secret_access_events" ADD CONSTRAINT "secret_access_events_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."secret_access_events" ADD CONSTRAINT "secret_access_events_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."secret_access_events" ADD CONSTRAINT "secret_access_events_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."secret_access_events" ADD CONSTRAINT "secret_access_events_secret_id_company_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."company_secrets" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."secret_access_events" ADD CONSTRAINT "secret_access_events_user_secret_definition_id_user_secret_defi" FOREIGN KEY ("user_secret_definition_id") REFERENCES "public"."user_secret_definitions" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."smoke_run_steps" ADD CONSTRAINT "smoke_run_steps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."smoke_run_steps" ADD CONSTRAINT "smoke_run_steps_run_id_smoke_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."smoke_runs" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."smoke_runs" ADD CONSTRAINT "smoke_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."status_card_updates" ADD CONSTRAINT "status_card_updates_card_id_status_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."status_cards" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."status_card_updates" ADD CONSTRAINT "status_card_updates_generation_issue_id_issues_id_fk" FOREIGN KEY ("generation_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."status_card_updates" ADD CONSTRAINT "status_card_updates_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."status_cards" ADD CONSTRAINT "status_cards_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."status_cards" ADD CONSTRAINT "status_cards_archived_by_agent_id_agents_id_fk" FOREIGN KEY ("archived_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."status_cards" ADD CONSTRAINT "status_cards_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."status_cards" ADD CONSTRAINT "status_cards_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."status_cards" ADD CONSTRAINT "status_cards_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."status_cards" ADD CONSTRAINT "status_cards_generating_issue_id_issues_id_fk" FOREIGN KEY ("generating_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."status_cards" ADD CONSTRAINT "status_cards_query_compiled_by_agent_id_agents_id_fk" FOREIGN KEY ("query_compiled_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."summary_slots" ADD CONSTRAINT "summary_slots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."summary_slots" ADD CONSTRAINT "summary_slots_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."summary_slots" ADD CONSTRAINT "summary_slots_generating_issue_id_issues_id_fk" FOREIGN KEY ("generating_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."summary_slots" ADD CONSTRAINT "summary_slots_last_generated_by_agent_id_agents_id_fk" FOREIGN KEY ("last_generated_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_access_audit_events" ADD CONSTRAINT "tool_access_audit_events_catalog_entry_id_tool_catalog_entries_" FOREIGN KEY ("catalog_entry_id") REFERENCES "public"."tool_catalog_entries" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_access_audit_events" ADD CONSTRAINT "tool_access_audit_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_access_audit_events" ADD CONSTRAINT "tool_access_audit_events_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_access_audit_events" ADD CONSTRAINT "tool_access_audit_events_gateway_id_tool_mcp_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."tool_mcp_gateways" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_access_audit_events" ADD CONSTRAINT "tool_access_audit_events_gateway_token_id_tool_mcp_gateway_toke" FOREIGN KEY ("gateway_token_id") REFERENCES "public"."tool_mcp_gateway_tokens" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_action_requests" ADD CONSTRAINT "tool_action_requests_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_action_requests" ADD CONSTRAINT "tool_action_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_action_requests" ADD CONSTRAINT "tool_action_requests_decided_by_agent_id_agents_id_fk" FOREIGN KEY ("decided_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_action_requests" ADD CONSTRAINT "tool_action_requests_interaction_id_issue_thread_interactions_i" FOREIGN KEY ("interaction_id") REFERENCES "public"."issue_thread_interactions" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_action_requests" ADD CONSTRAINT "tool_action_requests_invocation_id_tool_invocations_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "public"."tool_invocations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_action_requests" ADD CONSTRAINT "tool_action_requests_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_action_requests" ADD CONSTRAINT "tool_action_requests_requested_by_agent_id_agents_id_fk" FOREIGN KEY ("requested_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_action_requests" ADD CONSTRAINT "tool_action_requests_resolved_by_agent_id_agents_id_fk" FOREIGN KEY ("resolved_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_applications" ADD CONSTRAINT "tool_applications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_applications" ADD CONSTRAINT "tool_applications_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_applications" ADD CONSTRAINT "tool_applications_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_call_events" ADD CONSTRAINT "tool_call_events_action_request_id_tool_action_requests_id_fk" FOREIGN KEY ("action_request_id") REFERENCES "public"."tool_action_requests" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_call_events" ADD CONSTRAINT "tool_call_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_call_events" ADD CONSTRAINT "tool_call_events_application_id_tool_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."tool_applications" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_call_events" ADD CONSTRAINT "tool_call_events_catalog_entry_id_tool_catalog_entries_id_fk" FOREIGN KEY ("catalog_entry_id") REFERENCES "public"."tool_catalog_entries" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_call_events" ADD CONSTRAINT "tool_call_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_call_events" ADD CONSTRAINT "tool_call_events_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_call_events" ADD CONSTRAINT "tool_call_events_gateway_id_tool_mcp_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."tool_mcp_gateways" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_call_events" ADD CONSTRAINT "tool_call_events_gateway_token_id_tool_mcp_gateway_tokens_id_fk" FOREIGN KEY ("gateway_token_id") REFERENCES "public"."tool_mcp_gateway_tokens" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_call_events" ADD CONSTRAINT "tool_call_events_invocation_id_tool_invocations_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "public"."tool_invocations" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_call_events" ADD CONSTRAINT "tool_call_events_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_call_events" ADD CONSTRAINT "tool_call_events_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_call_events" ADD CONSTRAINT "tool_call_events_runtime_slot_id_tool_runtime_slots_id_fk" FOREIGN KEY ("runtime_slot_id") REFERENCES "public"."tool_runtime_slots" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_catalog_entries" ADD CONSTRAINT "tool_catalog_entries_application_id_tool_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."tool_applications" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_catalog_entries" ADD CONSTRAINT "tool_catalog_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_catalog_entries" ADD CONSTRAINT "tool_catalog_entries_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_catalog_entries" ADD CONSTRAINT "tool_catalog_entries_reviewed_by_agent_id_agents_id_fk" FOREIGN KEY ("reviewed_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_connection_installs" ADD CONSTRAINT "tool_connection_installs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_connection_installs" ADD CONSTRAINT "tool_connection_installs_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_connection_installs" ADD CONSTRAINT "tool_connection_installs_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_connections" ADD CONSTRAINT "tool_connections_application_id_tool_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."tool_applications" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_connections" ADD CONSTRAINT "tool_connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_connections" ADD CONSTRAINT "tool_connections_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_gateway_rate_limit_counters" ADD CONSTRAINT "tool_gateway_rate_limit_counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_gateway_sessions" ADD CONSTRAINT "tool_gateway_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_gateway_sessions" ADD CONSTRAINT "tool_gateway_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_gateway_sessions" ADD CONSTRAINT "tool_gateway_sessions_gateway_id_tool_mcp_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."tool_mcp_gateways" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_gateway_sessions" ADD CONSTRAINT "tool_gateway_sessions_gateway_token_id_tool_mcp_gateway_tokens_" FOREIGN KEY ("gateway_token_id") REFERENCES "public"."tool_mcp_gateway_tokens" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_gateway_sessions" ADD CONSTRAINT "tool_gateway_sessions_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_gateway_sessions" ADD CONSTRAINT "tool_gateway_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_gateway_sessions" ADD CONSTRAINT "tool_gateway_sessions_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_invocations" ADD CONSTRAINT "tool_invocations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_invocations" ADD CONSTRAINT "tool_invocations_application_id_tool_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."tool_applications" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_invocations" ADD CONSTRAINT "tool_invocations_catalog_entry_id_tool_catalog_entries_id_fk" FOREIGN KEY ("catalog_entry_id") REFERENCES "public"."tool_catalog_entries" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_invocations" ADD CONSTRAINT "tool_invocations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_invocations" ADD CONSTRAINT "tool_invocations_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_invocations" ADD CONSTRAINT "tool_invocations_gateway_id_tool_mcp_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."tool_mcp_gateways" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_invocations" ADD CONSTRAINT "tool_invocations_gateway_token_id_tool_mcp_gateway_tokens_id_fk" FOREIGN KEY ("gateway_token_id") REFERENCES "public"."tool_mcp_gateway_tokens" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_invocations" ADD CONSTRAINT "tool_invocations_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_invocations" ADD CONSTRAINT "tool_invocations_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_mcp_gateway_tokens" ADD CONSTRAINT "tool_mcp_gateway_tokens_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_mcp_gateway_tokens" ADD CONSTRAINT "tool_mcp_gateway_tokens_expiry_override_by_agent_id_agents_id_f" FOREIGN KEY ("expiry_override_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_mcp_gateway_tokens" ADD CONSTRAINT "tool_mcp_gateway_tokens_gateway_id_tool_mcp_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."tool_mcp_gateways" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_mcp_gateways" ADD CONSTRAINT "tool_mcp_gateways_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_mcp_gateways" ADD CONSTRAINT "tool_mcp_gateways_approval_issue_id_issues_id_fk" FOREIGN KEY ("approval_issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_mcp_gateways" ADD CONSTRAINT "tool_mcp_gateways_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_mcp_gateways" ADD CONSTRAINT "tool_mcp_gateways_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_mcp_gateways" ADD CONSTRAINT "tool_mcp_gateways_profile_id_tool_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tool_profiles" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_mcp_gateways" ADD CONSTRAINT "tool_mcp_gateways_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_oauth_states" ADD CONSTRAINT "tool_oauth_states_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_oauth_states" ADD CONSTRAINT "tool_oauth_states_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_policies" ADD CONSTRAINT "tool_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_policies" ADD CONSTRAINT "tool_policies_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_profile_bindings" ADD CONSTRAINT "tool_profile_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_profile_bindings" ADD CONSTRAINT "tool_profile_bindings_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_profile_bindings" ADD CONSTRAINT "tool_profile_bindings_profile_id_tool_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tool_profiles" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_profile_entries" ADD CONSTRAINT "tool_profile_entries_application_id_tool_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."tool_applications" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_profile_entries" ADD CONSTRAINT "tool_profile_entries_catalog_entry_id_tool_catalog_entries_id_f" FOREIGN KEY ("catalog_entry_id") REFERENCES "public"."tool_catalog_entries" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_profile_entries" ADD CONSTRAINT "tool_profile_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_profile_entries" ADD CONSTRAINT "tool_profile_entries_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_profile_entries" ADD CONSTRAINT "tool_profile_entries_profile_id_tool_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tool_profiles" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_profiles" ADD CONSTRAINT "tool_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_rate_limit_counters" ADD CONSTRAINT "tool_rate_limit_counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_rate_limit_counters" ADD CONSTRAINT "tool_rate_limit_counters_policy_id_tool_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."tool_policies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_runtime_metric_counters" ADD CONSTRAINT "tool_runtime_metric_counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_runtime_slots" ADD CONSTRAINT "tool_runtime_slots_application_id_tool_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."tool_applications" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_runtime_slots" ADD CONSTRAINT "tool_runtime_slots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_runtime_slots" ADD CONSTRAINT "tool_runtime_slots_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_runtime_slots" ADD CONSTRAINT "tool_runtime_slots_execution_workspace_id_execution_workspaces_" FOREIGN KEY ("execution_workspace_id") REFERENCES "public"."execution_workspaces" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_runtime_slots" ADD CONSTRAINT "tool_runtime_slots_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_runtime_slots" ADD CONSTRAINT "tool_runtime_slots_project_workspace_id_project_workspaces_id_f" FOREIGN KEY ("project_workspace_id") REFERENCES "public"."project_workspaces" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_stdio_command_templates" ADD CONSTRAINT "tool_stdio_command_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."tool_stdio_command_templates" ADD CONSTRAINT "tool_stdio_command_templates_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."user_inbox_agent_policies" ADD CONSTRAINT "user_inbox_agent_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."user_secret_declarations" ADD CONSTRAINT "user_secret_declarations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."user_secret_declarations" ADD CONSTRAINT "user_secret_declarations_user_secret_definition_id_user_secret_" FOREIGN KEY ("user_secret_definition_id") REFERENCES "public"."user_secret_definitions" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."user_secret_definitions" ADD CONSTRAINT "user_secret_definitions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."user_secret_definitions" ADD CONSTRAINT "user_secret_definitions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."user_secret_definitions" ADD CONSTRAINT "user_secret_definitions_provider_config_id_company_secret_provi" FOREIGN KEY ("provider_config_id") REFERENCES "public"."company_secret_provider_configs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."user_secret_definitions" ADD CONSTRAINT "user_secret_definitions_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."workspace_operations" ADD CONSTRAINT "workspace_operations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."workspace_operations" ADD CONSTRAINT "workspace_operations_execution_workspace_id_execution_workspace" FOREIGN KEY ("execution_workspace_id") REFERENCES "public"."execution_workspaces" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."workspace_operations" ADD CONSTRAINT "workspace_operations_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."workspace_operations" ADD CONSTRAINT "workspace_operations_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."workspace_runtime_services" ADD CONSTRAINT "workspace_runtime_services_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."workspace_runtime_services" ADD CONSTRAINT "workspace_runtime_services_execution_workspace_id_execution_wor" FOREIGN KEY ("execution_workspace_id") REFERENCES "public"."execution_workspaces" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."workspace_runtime_services" ADD CONSTRAINT "workspace_runtime_services_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."workspace_runtime_services" ADD CONSTRAINT "workspace_runtime_services_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."workspace_runtime_services" ADD CONSTRAINT "workspace_runtime_services_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."workspace_runtime_services" ADD CONSTRAINT "workspace_runtime_services_project_workspace_id_project_workspa" FOREIGN KEY ("project_workspace_id") REFERENCES "public"."project_workspaces" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
ALTER TABLE "public"."workspace_runtime_services" ADD CONSTRAINT "workspace_runtime_services_started_by_run_id_heartbeat_runs_id_" FOREIGN KEY ("started_by_run_id") REFERENCES "public"."heartbeat_runs" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Indexes
CREATE INDEX activity_log_company_agent_created_idx ON public.activity_log USING btree (company_id, agent_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX activity_log_company_created_idx ON public.activity_log USING btree (company_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX activity_log_company_responsible_user_created_idx ON public.activity_log USING btree (company_id, responsible_user_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX activity_log_entity_type_id_idx ON public.activity_log USING btree (entity_type, entity_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX activity_log_run_id_idx ON public.activity_log USING btree (run_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX agent_api_keys_company_agent_idx ON public.agent_api_keys USING btree (company_id, agent_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX agent_api_keys_key_hash_idx ON public.agent_api_keys USING btree (key_hash);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX agent_config_revisions_agent_created_idx ON public.agent_config_revisions USING btree (agent_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX agent_config_revisions_company_agent_created_idx ON public.agent_config_revisions USING btree (company_id, agent_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX agent_memberships_agent_idx ON public.agent_memberships USING btree (agent_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX agent_memberships_company_user_agent_uq ON public.agent_memberships USING btree (company_id, user_id, agent_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX agent_memberships_company_user_idx ON public.agent_memberships USING btree (company_id, user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX agent_memberships_company_user_starred_idx ON public.agent_memberships USING btree (company_id, user_id, starred_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX agent_runtime_state_company_agent_idx ON public.agent_runtime_state USING btree (company_id, agent_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX agent_runtime_state_company_updated_idx ON public.agent_runtime_state USING btree (company_id, updated_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX agent_task_sessions_company_agent_adapter_task_uniq ON public.agent_task_sessions USING btree (company_id, agent_id, adapter_type, task_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX agent_task_sessions_company_agent_updated_idx ON public.agent_task_sessions USING btree (company_id, agent_id, updated_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX agent_task_sessions_company_task_updated_idx ON public.agent_task_sessions USING btree (company_id, task_key, updated_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX agent_wakeup_requests_agent_requested_idx ON public.agent_wakeup_requests USING btree (agent_id, requested_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX agent_wakeup_requests_company_agent_status_idx ON public.agent_wakeup_requests USING btree (company_id, agent_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX agent_wakeup_requests_company_payload_issue_idx ON public.agent_wakeup_requests USING btree (company_id, ((payload ->> 'issueId'::text)));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX agent_wakeup_requests_company_requested_idx ON public.agent_wakeup_requests USING btree (company_id, requested_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX agent_wakeup_requests_review_path_recovery_idempotency_uq ON public.agent_wakeup_requests USING btree (company_id, idempotency_key) WHERE ((idempotency_key ~~ 'issue_review_path_lost:%'::text) AND (status <> 'skipped'::text));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX agents_company_built_in_agent_key_unique_idx ON public.agents USING btree (company_id, (((metadata -> 'paperclipBuiltInAgent'::text) ->> 'key'::text))) WHERE ((((metadata -> 'paperclipBuiltInAgent'::text) ->> 'key'::text) IS NOT NULL) AND (status <> 'terminated'::text));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX agents_company_default_environment_idx ON public.agents USING btree (company_id, default_environment_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX agents_company_reports_to_idx ON public.agents USING btree (company_id, reports_to);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX agents_company_status_idx ON public.agents USING btree (company_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX approval_comments_approval_created_idx ON public.approval_comments USING btree (approval_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX approval_comments_approval_idx ON public.approval_comments USING btree (approval_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX approval_comments_company_idx ON public.approval_comments USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX approvals_company_status_type_idx ON public.approvals USING btree (company_id, status, type);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX assets_company_created_idx ON public.assets USING btree (company_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX assets_company_object_key_uq ON public.assets USING btree (company_id, object_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX assets_company_provider_idx ON public.assets USING btree (company_id, provider);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX board_api_keys_key_hash_idx ON public.board_api_keys USING btree (key_hash);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX board_api_keys_user_idx ON public.board_api_keys USING btree (user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX budget_incidents_company_scope_idx ON public.budget_incidents USING btree (company_id, scope_type, scope_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX budget_incidents_company_status_idx ON public.budget_incidents USING btree (company_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX budget_incidents_policy_window_threshold_idx ON public.budget_incidents USING btree (policy_id, window_start, threshold_type) WHERE (status <> 'dismissed'::text);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX budget_policies_company_scope_active_idx ON public.budget_policies USING btree (company_id, scope_type, scope_id, is_active);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX budget_policies_company_scope_metric_unique_idx ON public.budget_policies USING btree (company_id, scope_type, scope_id, metric, window_kind);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX budget_policies_company_window_idx ON public.budget_policies USING btree (company_id, window_kind, metric);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX built_in_managed_resources_company_bundle_resource_uq ON public.built_in_managed_resources USING btree (company_id, bundle_key, resource_kind, resource_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX built_in_managed_resources_company_idx ON public.built_in_managed_resources USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX built_in_managed_resources_resource_idx ON public.built_in_managed_resources USING btree (resource_kind, resource_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX case_attachments_asset_uq ON public.case_attachments USING btree (asset_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX case_attachments_company_case_idx ON public.case_attachments USING btree (company_id, case_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX case_documents_company_case_key_uq ON public.case_documents USING btree (company_id, case_id, key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX case_documents_company_case_updated_idx ON public.case_documents USING btree (company_id, case_id, updated_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX case_documents_document_uq ON public.case_documents USING btree (document_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX case_events_case_created_idx ON public.case_events USING btree (case_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX case_events_company_case_idx ON public.case_events USING btree (company_id, case_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX case_issue_links_case_issue_uq ON public.case_issue_links USING btree (case_id, issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX case_issue_links_company_case_idx ON public.case_issue_links USING btree (company_id, case_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX case_issue_links_issue_idx ON public.case_issue_links USING btree (issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX case_labels_case_label_uq ON public.case_labels USING btree (case_id, label_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX case_labels_company_case_idx ON public.case_labels USING btree (company_id, case_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX case_labels_label_idx ON public.case_labels USING btree (label_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX cases_company_case_number_uq ON public.cases USING btree (company_id, case_number);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX cases_company_project_idx ON public.cases USING btree (company_id, project_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX cases_company_status_idx ON public.cases USING btree (company_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX cases_company_type_idx ON public.cases USING btree (company_id, case_type);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX cases_company_type_key_uq ON public.cases USING btree (company_id, case_type, key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX cases_identifier_search_idx ON public.cases USING gin (identifier gin_trgm_ops);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX cases_identifier_uq ON public.cases USING btree (identifier);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX cases_parent_idx ON public.cases USING btree (parent_case_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX cases_summary_search_idx ON public.cases USING gin (summary gin_trgm_ops);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX cases_title_search_idx ON public.cases USING gin (title gin_trgm_ops);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX cli_auth_challenges_approved_by_idx ON public.cli_auth_challenges USING btree (approved_by_user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX cli_auth_challenges_requested_company_idx ON public.cli_auth_challenges USING btree (requested_company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX cli_auth_challenges_secret_hash_idx ON public.cli_auth_challenges USING btree (secret_hash);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX companies_default_responsible_user_idx ON public.companies USING btree (default_responsible_user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX companies_issue_prefix_idx ON public.companies USING btree (issue_prefix);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX company_logos_asset_uq ON public.company_logos USING btree (asset_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX company_logos_company_uq ON public.company_logos USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX company_memberships_company_principal_unique_idx ON public.company_memberships USING btree (company_id, principal_type, principal_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_memberships_company_status_idx ON public.company_memberships USING btree (company_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_memberships_principal_status_idx ON public.company_memberships USING btree (principal_type, principal_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_secret_bindings_company_idx ON public.company_secret_bindings USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_secret_bindings_secret_idx ON public.company_secret_bindings USING btree (secret_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_secret_bindings_target_idx ON public.company_secret_bindings USING btree (company_id, target_type, target_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX company_secret_bindings_target_path_uq ON public.company_secret_bindings USING btree (company_id, target_type, target_id, config_path);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_secret_proposals_company_status_idx ON public.company_secret_proposals USING btree (company_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_secret_proposals_expiry_idx ON public.company_secret_proposals USING btree (status, expires_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_secret_proposals_proposer_status_idx ON public.company_secret_proposals USING btree (proposed_by_agent_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_secret_proposals_secret_proposal_idx ON public.company_secret_proposals USING btree (secret_proposal_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_secret_provider_configs_company_idx ON public.company_secret_provider_configs USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_secret_provider_configs_company_provider_idx ON public.company_secret_provider_configs USING btree (company_id, provider);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX company_secret_provider_configs_default_uq ON public.company_secret_provider_configs USING btree (company_id, provider) WHERE (is_default = true);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_secret_versions_fingerprint_idx ON public.company_secret_versions USING btree (fingerprint_sha256);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_secret_versions_secret_idx ON public.company_secret_versions USING btree (secret_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX company_secret_versions_secret_version_uq ON public.company_secret_versions USING btree (secret_id, version);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_secret_versions_value_sha256_idx ON public.company_secret_versions USING btree (value_sha256);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_secrets_company_idx ON public.company_secrets USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX company_secrets_company_key_uq ON public.company_secrets USING btree (company_id, key) WHERE ((scope = 'company'::text) AND (deleted_at IS NULL));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX company_secrets_company_name_uq ON public.company_secrets USING btree (company_id, name) WHERE ((scope = 'company'::text) AND (deleted_at IS NULL));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_secrets_company_owner_idx ON public.company_secrets USING btree (company_id, owner_user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_secrets_company_provider_idx ON public.company_secrets USING btree (company_id, provider);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_secrets_company_scope_idx ON public.company_secrets USING btree (company_id, scope);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_secrets_provider_config_idx ON public.company_secrets USING btree (provider_config_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_secrets_user_definition_owner_idx ON public.company_secrets USING btree (company_id, user_secret_definition_id, owner_user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX company_secrets_user_definition_owner_uq ON public.company_secrets USING btree (company_id, user_secret_definition_id, owner_user_id) WHERE ((scope = 'user'::text) AND (deleted_at IS NULL));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_skill_comments_company_skill_created_idx ON public.company_skill_comments USING btree (company_id, company_skill_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_skill_comments_parent_idx ON public.company_skill_comments USING btree (parent_comment_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_skill_stars_company_skill_created_idx ON public.company_skill_stars USING btree (company_id, company_skill_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX company_skill_stars_skill_agent_idx ON public.company_skill_stars USING btree (company_skill_id, agent_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX company_skill_stars_skill_user_idx ON public.company_skill_stars USING btree (company_skill_id, user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_skill_test_inputs_company_skill_active_idx ON public.company_skill_test_inputs USING btree (company_id, skill_id, deleted_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_skill_test_inputs_company_skill_name_idx ON public.company_skill_test_inputs USING btree (company_id, skill_id, name);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_skill_test_run_templates_company_active_idx ON public.company_skill_test_run_templates USING btree (company_id, deleted_at, name);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_skill_test_runs_company_harness_expires_idx ON public.company_skill_test_runs USING btree (company_id, harness_issue_expires_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_skill_test_runs_company_input_created_idx ON public.company_skill_test_runs USING btree (company_id, input_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX company_skill_test_runs_company_issue_idx ON public.company_skill_test_runs USING btree (company_id, issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_skill_test_runs_company_skill_created_idx ON public.company_skill_test_runs USING btree (company_id, skill_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_skill_test_runs_company_status_idx ON public.company_skill_test_runs USING btree (company_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_skill_versions_company_skill_created_idx ON public.company_skill_versions USING btree (company_id, company_skill_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX company_skill_versions_skill_release_idx ON public.company_skill_versions USING btree (company_skill_id, release_id) WHERE (release_id IS NOT NULL);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX company_skill_versions_skill_revision_idx ON public.company_skill_versions USING btree (company_skill_id, revision_number);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_skills_company_categories_idx ON public.company_skills USING gin (categories);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_skills_company_current_version_idx ON public.company_skills USING btree (company_id, current_version_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_skills_company_folder_idx ON public.company_skills USING btree (company_id, folder_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_skills_company_forked_from_idx ON public.company_skills USING btree (company_id, forked_from_skill_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX company_skills_company_key_idx ON public.company_skills USING btree (company_id, key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_skills_company_name_idx ON public.company_skills USING btree (company_id, name);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_skills_company_sharing_scope_idx ON public.company_skills USING btree (company_id, sharing_scope);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_user_sidebar_preferences_company_idx ON public.company_user_sidebar_preferences USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX company_user_sidebar_preferences_company_user_uq ON public.company_user_sidebar_preferences USING btree (company_id, user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX company_user_sidebar_preferences_user_idx ON public.company_user_sidebar_preferences USING btree (user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX connection_grants_company_connection_idx ON public.connection_grants USING btree (company_id, connection_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX connection_grants_default_uq ON public.connection_grants USING btree (connection_id) WHERE ((is_default = true) AND (kind = 'workspace'::text));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX connection_grants_subject_user_idx ON public.connection_grants USING btree (company_id, subject_user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX connection_grants_user_uq ON public.connection_grants USING btree (connection_id, subject_user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX connection_token_issuances_agent_connection_idx ON public.connection_token_issuances USING btree (company_id, agent_id, connection_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX connection_token_issuances_company_created_idx ON public.connection_token_issuances USING btree (company_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX connection_token_issuances_connection_created_idx ON public.connection_token_issuances USING btree (company_id, connection_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX connection_token_issuances_run_idx ON public.connection_token_issuances USING btree (company_id, run_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX cost_events_company_agent_occurred_idx ON public.cost_events USING btree (company_id, agent_id, occurred_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX cost_events_company_biller_occurred_idx ON public.cost_events USING btree (company_id, biller, occurred_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX cost_events_company_heartbeat_run_idx ON public.cost_events USING btree (company_id, heartbeat_run_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX cost_events_company_occurred_idx ON public.cost_events USING btree (company_id, occurred_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX cost_events_company_provider_occurred_idx ON public.cost_events USING btree (company_id, provider, occurred_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX decision_archive_notification_outbox_pending_idx ON public.decision_archive_notification_outbox USING btree (status, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX decision_archive_notification_outbox_uq ON public.decision_archive_notification_outbox USING btree (company_id, source_kind, source_id, archive_version, origin_agent_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX decision_bundles_company_created_at_idx ON public.decision_bundles USING btree (company_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX decision_effect_executions_decision_effect_uq ON public.decision_effect_executions USING btree (decision_id, effect_index);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX decision_effect_executions_target_issue_idx ON public.decision_effect_executions USING btree (target_issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX decision_queue_items_company_source_idx ON public.decision_queue_items USING btree (company_id, source_kind, source_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX decision_queue_items_queue_source_uq ON public.decision_queue_items USING btree (queue_id, source_kind, source_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX decision_queues_company_key_uq ON public.decision_queues USING btree (company_id, key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX decision_queues_company_updated_idx ON public.decision_queues USING btree (company_id, updated_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX decision_retention_company_archived_idx ON public.decision_retention USING btree (company_id, archived_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX decision_retention_company_source_uq ON public.decision_retention USING btree (company_id, source_kind, source_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX decision_target_issues_decision_idx ON public.decision_target_issues USING btree (decision_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX decision_target_issues_issue_idx ON public.decision_target_issues USING btree (issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX decision_training_examples_company_created_at_idx ON public.decision_training_examples USING btree (company_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX decision_training_examples_issue_idx ON public.decision_training_examples USING btree (issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX decision_training_examples_source_author_uq ON public.decision_training_examples USING btree (source_kind, source_id, created_by_user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX decision_triage_company_decide_by_idx ON public.decision_triage USING btree (company_id, decide_by);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX decision_triage_company_source_uq ON public.decision_triage USING btree (company_id, source_kind, source_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX decision_triage_events_company_source_created_idx ON public.decision_triage_events USING btree (company_id, source_kind, source_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX decision_triage_events_queue_created_idx ON public.decision_triage_events USING btree (queue_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX decisions_bundle_idx ON public.decisions USING btree (bundle_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX decisions_company_idempotency_uq ON public.decisions USING btree (company_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX decisions_company_status_expires_at_idx ON public.decisions USING btree (company_id, status, expires_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX decisions_origin_issue_idx ON public.decisions USING btree (origin_issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX document_annotation_anchor_snapshots_company_document_revision_ ON public.document_annotation_anchor_snapshots USING btree (company_id, document_id, to_revision_number);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX document_annotation_anchor_snapshots_company_thread_created_at_ ON public.document_annotation_anchor_snapshots USING btree (company_id, thread_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX document_annotation_comments_body_search_idx ON public.document_annotation_comments USING gin (body gin_trgm_ops);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX document_annotation_comments_company_case_created_at_idx ON public.document_annotation_comments USING btree (company_id, case_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX document_annotation_comments_company_document_created_at_idx ON public.document_annotation_comments USING btree (company_id, document_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX document_annotation_comments_company_issue_created_at_idx ON public.document_annotation_comments USING btree (company_id, issue_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX document_annotation_comments_company_routine_created_at_idx ON public.document_annotation_comments USING btree (company_id, routine_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX document_annotation_comments_company_thread_created_at_idx ON public.document_annotation_comments USING btree (company_id, thread_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX document_annotation_comments_issue_comment_idx ON public.document_annotation_comments USING btree (issue_comment_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX document_annotation_threads_company_anchor_state_idx ON public.document_annotation_threads USING btree (company_id, anchor_state);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX document_annotation_threads_company_case_status_idx ON public.document_annotation_threads USING btree (company_id, case_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX document_annotation_threads_company_current_revision_open_idx ON public.document_annotation_threads USING btree (company_id, document_id, current_revision_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX document_annotation_threads_company_document_status_idx ON public.document_annotation_threads USING btree (company_id, document_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX document_annotation_threads_company_issue_status_idx ON public.document_annotation_threads USING btree (company_id, issue_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX document_annotation_threads_company_routine_status_idx ON public.document_annotation_threads USING btree (company_id, routine_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX document_memberships_company_user_document_uq ON public.document_memberships USING btree (company_id, user_id, document_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX document_memberships_company_user_starred_idx ON public.document_memberships USING btree (company_id, user_id, starred_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX document_revisions_company_document_created_idx ON public.document_revisions USING btree (company_id, document_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX document_revisions_document_revision_uq ON public.document_revisions USING btree (document_id, revision_number);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX documents_company_created_idx ON public.documents USING btree (company_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX documents_company_updated_idx ON public.documents USING btree (company_id, updated_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX documents_latest_body_search_idx ON public.documents USING gin (latest_body gin_trgm_ops);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX documents_title_search_idx ON public.documents USING gin (title gin_trgm_ops);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX environment_custom_image_setup_sessions_environment_active_uq ON public.environment_custom_image_setup_sessions USING btree (environment_id) WHERE (status = ANY (ARRAY['starting'::text, 'waiting_for_user'::text, 'capturing'::text]));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX environment_custom_image_setup_sessions_environment_status_idx ON public.environment_custom_image_setup_sessions USING btree (environment_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX environment_custom_image_setup_sessions_expires_idx ON public.environment_custom_image_setup_sessions USING btree (expires_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX environment_custom_image_setup_sessions_promoted_template_idx ON public.environment_custom_image_setup_sessions USING btree (promoted_template_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX environment_custom_image_setup_sessions_provider_lease_idx ON public.environment_custom_image_setup_sessions USING btree (provider, provider_lease_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX environment_custom_image_setup_sessions_template_idx ON public.environment_custom_image_setup_sessions USING btree (template_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX environment_custom_image_templates_environment_active_uq ON public.environment_custom_image_templates USING btree (environment_id) WHERE (status = 'active'::text);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX environment_custom_image_templates_environment_provider_status_ ON public.environment_custom_image_templates USING btree (environment_id, provider, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX environment_custom_image_templates_environment_status_idx ON public.environment_custom_image_templates USING btree (environment_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX environment_custom_image_templates_last_used_idx ON public.environment_custom_image_templates USING btree (last_used_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX environment_custom_image_templates_superseded_by_idx ON public.environment_custom_image_templates USING btree (superseded_by_template_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX environment_leases_company_environment_status_idx ON public.environment_leases USING btree (company_id, environment_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX environment_leases_company_execution_workspace_idx ON public.environment_leases USING btree (company_id, execution_workspace_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX environment_leases_company_issue_idx ON public.environment_leases USING btree (company_id, issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX environment_leases_company_last_used_idx ON public.environment_leases USING btree (company_id, last_used_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX environment_leases_heartbeat_run_idx ON public.environment_leases USING btree (heartbeat_run_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX environment_leases_provider_lease_idx ON public.environment_leases USING btree (provider_lease_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX environments_local_driver_idx ON public.environments USING btree (driver) WHERE (driver = 'local'::text);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX environments_managed_sandbox_idx ON public.environments USING btree (driver) WHERE ((driver = 'sandbox'::text) AND (((metadata ->> 'managedByPaperclip'::text))::boolean = true));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX environments_name_idx ON public.environments USING btree (name);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX environments_status_idx ON public.environments USING btree (status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX execution_workspaces_company_branch_idx ON public.execution_workspaces USING btree (company_id, branch_name);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX execution_workspaces_company_last_used_idx ON public.execution_workspaces USING btree (company_id, last_used_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX execution_workspaces_company_project_status_idx ON public.execution_workspaces USING btree (company_id, project_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX execution_workspaces_company_project_workspace_status_idx ON public.execution_workspaces USING btree (company_id, project_workspace_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX execution_workspaces_company_source_issue_idx ON public.execution_workspaces USING btree (company_id, source_issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX external_object_mentions_company_object_idx ON public.external_object_mentions USING btree (company_id, object_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX external_object_mentions_company_provider_idx ON public.external_object_mentions USING btree (company_id, provider_key, object_type);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX external_object_mentions_company_source_issue_idx ON public.external_object_mentions USING btree (company_id, source_issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX external_object_mentions_company_source_null_record_uq ON public.external_object_mentions USING btree (company_id, source_issue_id, source_kind, document_key, property_key, canonical_identity_hash) WHERE ((source_record_id IS NULL) AND (canonical_identity_hash IS NOT NULL));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX external_object_mentions_company_source_record_uq ON public.external_object_mentions USING btree (company_id, source_issue_id, source_kind, source_record_id, document_key, property_key, canonical_identity_hash) WHERE ((source_record_id IS NOT NULL) AND (canonical_identity_hash IS NOT NULL));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX external_objects_company_external_id_uq ON public.external_objects USING btree (company_id, provider_key, object_type, external_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX external_objects_company_identity_uq ON public.external_objects USING btree (company_id, provider_key, object_type, canonical_identity_hash);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX external_objects_company_provider_object_idx ON public.external_objects USING btree (company_id, provider_key, object_type);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX external_objects_company_provider_status_idx ON public.external_objects USING btree (company_id, provider_key, status_category);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX external_objects_company_refresh_idx ON public.external_objects USING btree (company_id, next_refresh_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX feedback_exports_company_author_idx ON public.feedback_exports USING btree (company_id, author_user_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX feedback_exports_company_created_idx ON public.feedback_exports USING btree (company_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX feedback_exports_company_issue_idx ON public.feedback_exports USING btree (company_id, issue_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX feedback_exports_company_project_idx ON public.feedback_exports USING btree (company_id, project_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX feedback_exports_company_status_idx ON public.feedback_exports USING btree (company_id, status, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX feedback_exports_feedback_vote_idx ON public.feedback_exports USING btree (feedback_vote_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX feedback_votes_author_idx ON public.feedback_votes USING btree (author_user_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX feedback_votes_company_issue_idx ON public.feedback_votes USING btree (company_id, issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX feedback_votes_company_target_author_idx ON public.feedback_votes USING btree (company_id, target_type, target_id, author_user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX feedback_votes_issue_target_idx ON public.feedback_votes USING btree (issue_id, target_type, target_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX finance_events_company_biller_occurred_idx ON public.finance_events USING btree (company_id, biller, occurred_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX finance_events_company_cost_event_idx ON public.finance_events USING btree (company_id, cost_event_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX finance_events_company_direction_occurred_idx ON public.finance_events USING btree (company_id, direction, occurred_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX finance_events_company_heartbeat_run_idx ON public.finance_events USING btree (company_id, heartbeat_run_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX finance_events_company_kind_occurred_idx ON public.finance_events USING btree (company_id, event_kind, occurred_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX finance_events_company_occurred_idx ON public.finance_events USING btree (company_id, occurred_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX folders_company_kind_parent_position_idx ON public.folders USING btree (company_id, kind, parent_id, "position", name);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX folders_company_kind_parent_slug_uq ON public.folders USING btree (company_id, kind, parent_id, slug) WHERE (parent_id IS NOT NULL);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX folders_company_kind_position_idx ON public.folders USING btree (company_id, kind, "position", name);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX folders_company_kind_root_slug_uq ON public.folders USING btree (company_id, kind, slug) WHERE (parent_id IS NULL);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX folders_company_kind_system_key_uq ON public.folders USING btree (company_id, kind, system_key) WHERE (system_key IS NOT NULL);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX goals_company_idx ON public.goals USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX heartbeat_run_events_company_created_idx ON public.heartbeat_run_events USING btree (company_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX heartbeat_run_events_company_run_idx ON public.heartbeat_run_events USING btree (company_id, run_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX heartbeat_run_events_run_seq_idx ON public.heartbeat_run_events USING btree (run_id, seq);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX heartbeat_run_watchdog_decisions_company_run_created_idx ON public.heartbeat_run_watchdog_decisions USING btree (company_id, run_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX heartbeat_run_watchdog_decisions_company_run_snooze_idx ON public.heartbeat_run_watchdog_decisions USING btree (company_id, run_id, snoozed_until);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX heartbeat_runs_company_agent_started_idx ON public.heartbeat_runs USING btree (company_id, agent_id, started_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX heartbeat_runs_company_created_at_desc_idx ON public.heartbeat_runs USING btree (company_id, created_at DESC);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX heartbeat_runs_company_ctx_issue_created_idx ON public.heartbeat_runs USING btree (company_id, ((context_snapshot ->> 'issueId'::text)), created_at DESC);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX heartbeat_runs_company_ctx_task_created_idx ON public.heartbeat_runs USING btree (company_id, ((context_snapshot ->> 'taskId'::text)), created_at DESC);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX heartbeat_runs_company_ctx_taskkey_created_idx ON public.heartbeat_runs USING btree (company_id, ((context_snapshot ->> 'taskKey'::text)), created_at DESC);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX heartbeat_runs_company_liveness_idx ON public.heartbeat_runs USING btree (company_id, liveness_state, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX heartbeat_runs_company_responsible_user_idx ON public.heartbeat_runs USING btree (company_id, responsible_user_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX heartbeat_runs_company_status_last_output_idx ON public.heartbeat_runs USING btree (company_id, status, last_output_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX heartbeat_runs_company_status_process_started_idx ON public.heartbeat_runs USING btree (company_id, status, process_started_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX inbox_dismissals_company_item_idx ON public.inbox_dismissals USING btree (company_id, item_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX inbox_dismissals_company_user_idx ON public.inbox_dismissals USING btree (company_id, user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX inbox_dismissals_company_user_item_idx ON public.inbox_dismissals USING btree (company_id, user_id, item_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX instance_settings_singleton_key_idx ON public.instance_settings USING btree (singleton_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX instance_user_roles_role_idx ON public.instance_user_roles USING btree (role);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX instance_user_roles_user_role_unique_idx ON public.instance_user_roles USING btree (user_id, role);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX invites_company_invite_state_idx ON public.invites USING btree (company_id, invite_type, revoked_at, expires_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX invites_token_hash_unique_idx ON public.invites USING btree (token_hash);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_approvals_approval_idx ON public.issue_approvals USING btree (approval_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_approvals_company_idx ON public.issue_approvals USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_approvals_issue_idx ON public.issue_approvals USING btree (issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issue_attachments_asset_uq ON public.issue_attachments USING btree (asset_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_attachments_company_issue_idx ON public.issue_attachments USING btree (company_id, issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_attachments_issue_comment_idx ON public.issue_attachments USING btree (issue_comment_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_comments_body_search_idx ON public.issue_comments USING gin (body gin_trgm_ops);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_comments_company_author_issue_created_at_idx ON public.issue_comments USING btree (company_id, author_user_id, issue_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_comments_company_idx ON public.issue_comments USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_comments_company_issue_created_at_idx ON public.issue_comments USING btree (company_id, issue_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_comments_issue_idx ON public.issue_comments USING btree (issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_create_idempotency_keys_company_created_at_idx ON public.issue_create_idempotency_keys USING btree (company_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issue_create_idempotency_keys_company_key_uq ON public.issue_create_idempotency_keys USING btree (company_id, idempotency_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_create_idempotency_keys_issue_idx ON public.issue_create_idempotency_keys USING btree (issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issue_documents_company_issue_key_uq ON public.issue_documents USING btree (company_id, issue_id, key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_documents_company_issue_updated_idx ON public.issue_documents USING btree (company_id, issue_id, updated_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issue_documents_document_uq ON public.issue_documents USING btree (document_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_execution_decisions_company_issue_idx ON public.issue_execution_decisions USING btree (company_id, issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_execution_decisions_stage_idx ON public.issue_execution_decisions USING btree (issue_id, stage_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_inbox_archives_company_issue_idx ON public.issue_inbox_archives USING btree (company_id, issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issue_inbox_archives_company_issue_user_idx ON public.issue_inbox_archives USING btree (company_id, issue_id, user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_inbox_archives_company_user_idx ON public.issue_inbox_archives USING btree (company_id, user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_labels_company_idx ON public.issue_labels USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_labels_issue_idx ON public.issue_labels USING btree (issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_labels_label_idx ON public.issue_labels USING btree (label_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_plan_decompositions_active_owner_idx ON public.issue_plan_decompositions USING btree (company_id, owner_agent_id) WHERE (status = 'in_flight'::text);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_plan_decompositions_company_source_status_idx ON public.issue_plan_decompositions USING btree (company_id, source_issue_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issue_plan_decompositions_source_revision_uq ON public.issue_plan_decompositions USING btree (company_id, source_issue_id, accepted_plan_revision_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_read_states_company_issue_idx ON public.issue_read_states USING btree (company_id, issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issue_read_states_company_issue_user_idx ON public.issue_read_states USING btree (company_id, issue_id, user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_read_states_company_user_idx ON public.issue_read_states USING btree (company_id, user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issue_recovery_actions_active_fingerprint_uq ON public.issue_recovery_actions USING btree (company_id, source_issue_id, cause, fingerprint) WHERE (status = ANY (ARRAY['active'::text, 'escalated'::text]));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issue_recovery_actions_active_source_uq ON public.issue_recovery_actions USING btree (company_id, source_issue_id) WHERE (status = ANY (ARRAY['active'::text, 'escalated'::text]));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_recovery_actions_company_owner_status_idx ON public.issue_recovery_actions USING btree (company_id, owner_agent_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_recovery_actions_company_recovery_issue_idx ON public.issue_recovery_actions USING btree (company_id, recovery_issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_recovery_actions_company_source_status_idx ON public.issue_recovery_actions USING btree (company_id, source_issue_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_reference_mentions_company_issue_pair_idx ON public.issue_reference_mentions USING btree (company_id, source_issue_id, target_issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_reference_mentions_company_source_issue_idx ON public.issue_reference_mentions USING btree (company_id, source_issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issue_reference_mentions_company_source_mention_null_record_uq ON public.issue_reference_mentions USING btree (company_id, source_issue_id, target_issue_id, source_kind) WHERE (source_record_id IS NULL);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issue_reference_mentions_company_source_mention_record_uq ON public.issue_reference_mentions USING btree (company_id, source_issue_id, target_issue_id, source_kind, source_record_id) WHERE (source_record_id IS NOT NULL);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_reference_mentions_company_target_issue_idx ON public.issue_reference_mentions USING btree (company_id, target_issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issue_relations_company_edge_uq ON public.issue_relations USING btree (company_id, issue_id, related_issue_id, type);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_relations_company_issue_idx ON public.issue_relations USING btree (company_id, issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_relations_company_related_issue_idx ON public.issue_relations USING btree (company_id, related_issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_relations_company_type_idx ON public.issue_relations USING btree (company_id, type);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_thread_interactions_addressee_agent_idx ON public.issue_thread_interactions USING btree (addressee_agent_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_thread_interactions_company_issue_created_at_idx ON public.issue_thread_interactions USING btree (company_id, issue_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issue_thread_interactions_company_issue_idempotency_uq ON public.issue_thread_interactions USING btree (company_id, issue_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_thread_interactions_company_issue_status_idx ON public.issue_thread_interactions USING btree (company_id, issue_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_thread_interactions_issue_idx ON public.issue_thread_interactions USING btree (issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_thread_interactions_source_comment_idx ON public.issue_thread_interactions USING btree (source_comment_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_tree_hold_members_company_issue_idx ON public.issue_tree_hold_members USING btree (company_id, issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_tree_hold_members_hold_depth_idx ON public.issue_tree_hold_members USING btree (hold_id, depth);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issue_tree_hold_members_hold_issue_uq ON public.issue_tree_hold_members USING btree (hold_id, issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_tree_holds_company_root_status_idx ON public.issue_tree_holds USING btree (company_id, root_issue_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_tree_holds_company_status_mode_idx ON public.issue_tree_holds USING btree (company_id, status, mode);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_watchdogs_company_agent_idx ON public.issue_watchdogs USING btree (company_id, watchdog_agent_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issue_watchdogs_company_issue_uq ON public.issue_watchdogs USING btree (company_id, issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_watchdogs_company_status_idx ON public.issue_watchdogs USING btree (company_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issue_watchdogs_company_watchdog_issue_uq ON public.issue_watchdogs USING btree (company_id, watchdog_issue_id) WHERE (watchdog_issue_id IS NOT NULL);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_work_products_company_execution_workspace_type_idx ON public.issue_work_products USING btree (company_id, execution_workspace_id, type);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_work_products_company_issue_type_idx ON public.issue_work_products USING btree (company_id, issue_id, type);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_work_products_company_provider_external_id_idx ON public.issue_work_products USING btree (company_id, provider, external_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issue_work_products_company_updated_idx ON public.issue_work_products USING btree (company_id, updated_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issues_active_liveness_recovery_incident_uq ON public.issues USING btree (company_id, origin_kind, origin_id) WHERE ((origin_kind = 'harness_liveness_escalation'::text) AND (origin_id IS NOT NULL) AND (hidden_at IS NULL) AND (status <> ALL (ARRAY['done'::text, 'cancelled'::text])));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issues_active_liveness_recovery_leaf_uq ON public.issues USING btree (company_id, origin_kind, origin_fingerprint) WHERE ((origin_kind = 'harness_liveness_escalation'::text) AND (origin_fingerprint <> 'default'::text) AND (hidden_at IS NULL) AND (status <> ALL (ARRAY['done'::text, 'cancelled'::text])));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issues_active_productivity_review_uq ON public.issues USING btree (company_id, origin_kind, origin_id) WHERE ((origin_kind = 'issue_productivity_review'::text) AND (origin_id IS NOT NULL) AND (hidden_at IS NULL) AND (status <> ALL (ARRAY['done'::text, 'cancelled'::text])));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issues_active_stale_run_evaluation_uq ON public.issues USING btree (company_id, origin_kind, origin_id) WHERE ((origin_kind = 'stale_active_run_evaluation'::text) AND (origin_id IS NOT NULL) AND (hidden_at IS NULL) AND (status <> ALL (ARRAY['done'::text, 'cancelled'::text])));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issues_active_stranded_issue_recovery_uq ON public.issues USING btree (company_id, origin_kind, origin_id) WHERE ((origin_kind = 'stranded_issue_recovery'::text) AND (origin_id IS NOT NULL) AND (hidden_at IS NULL) AND (status <> ALL (ARRAY['done'::text, 'cancelled'::text])));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issues_active_task_watchdog_uq ON public.issues USING btree (company_id, origin_kind, origin_id) WHERE ((origin_kind = 'task_watchdog'::text) AND (origin_id IS NOT NULL) AND (hidden_at IS NULL) AND (status <> ALL (ARRAY['done'::text, 'cancelled'::text])));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issues_company_assignee_status_idx ON public.issues USING btree (company_id, assignee_agent_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issues_company_assignee_user_status_idx ON public.issues USING btree (company_id, assignee_user_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issues_company_created_idx ON public.issues USING btree (company_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issues_company_execution_workspace_idx ON public.issues USING btree (company_id, execution_workspace_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issues_company_harness_kind_idx ON public.issues USING btree (company_id, harness_kind);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issues_company_monitor_due_idx ON public.issues USING btree (company_id, monitor_next_check_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issues_company_origin_idx ON public.issues USING btree (company_id, origin_kind, origin_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issues_company_parent_idx ON public.issues USING btree (company_id, parent_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issues_company_priority_idx ON public.issues USING btree (company_id, priority);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issues_company_project_idx ON public.issues USING btree (company_id, project_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issues_company_project_workspace_idx ON public.issues USING btree (company_id, project_workspace_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issues_company_responsible_user_idx ON public.issues USING btree (company_id, responsible_user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issues_company_status_idx ON public.issues USING btree (company_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issues_company_updated_idx ON public.issues USING btree (company_id, updated_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issues_description_search_idx ON public.issues USING gin (description gin_trgm_ops);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issues_identifier_idx ON public.issues USING btree (identifier);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issues_identifier_search_idx ON public.issues USING gin (identifier gin_trgm_ops);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issues_open_normalized_title_created_idx ON public.issues USING btree (company_id, parent_id, lower(regexp_replace(btrim(title), '\s+'::text, ' '::text, 'g'::text)), created_at) WHERE ((hidden_at IS NULL) AND (status <> ALL (ARRAY['done'::text, 'cancelled'::text])));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX issues_open_routine_execution_uq ON public.issues USING btree (company_id, origin_kind, origin_id, origin_fingerprint) WHERE ((origin_kind = 'routine_execution'::text) AND (origin_id IS NOT NULL) AND (hidden_at IS NULL) AND (execution_run_id IS NOT NULL) AND (status = ANY (ARRAY['backlog'::text, 'todo'::text, 'in_progress'::text, 'in_review'::text, 'blocked'::text])));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX issues_title_search_idx ON public.issues USING gin (title gin_trgm_ops);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX join_requests_company_status_type_created_idx ON public.join_requests USING btree (company_id, status, request_type, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX join_requests_invite_unique_idx ON public.join_requests USING btree (invite_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX join_requests_pending_human_email_uq ON public.join_requests USING btree (company_id, lower(request_email_snapshot)) WHERE ((request_type = 'human'::text) AND (status = 'pending_approval'::text) AND (request_email_snapshot IS NOT NULL));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX join_requests_pending_human_user_uq ON public.join_requests USING btree (company_id, requesting_user_id) WHERE ((request_type = 'human'::text) AND (status = 'pending_approval'::text) AND (requesting_user_id IS NOT NULL));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX labels_company_idx ON public.labels USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX labels_company_name_idx ON public.labels USING btree (company_id, name);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_automation_executions_company_case_idx ON public.pipeline_automation_executions USING btree (company_id, case_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_automation_executions_execution_issue_idx ON public.pipeline_automation_executions USING btree (execution_issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX pipeline_automation_executions_idempotency_uq ON public.pipeline_automation_executions USING btree (case_id, automation_id, triggering_event_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_automation_executions_retry_of_execution_idx ON public.pipeline_automation_executions USING btree (retry_of_execution_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_automation_executions_routine_idx ON public.pipeline_automation_executions USING btree (routine_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_case_blockers_blocked_by_idx ON public.pipeline_case_blockers USING btree (blocked_by_case_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX pipeline_case_blockers_case_blocked_by_uq ON public.pipeline_case_blockers USING btree (case_id, blocked_by_case_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_case_blockers_company_case_idx ON public.pipeline_case_blockers USING btree (company_id, case_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX pipeline_case_documents_company_case_key_uq ON public.pipeline_case_documents USING btree (company_id, case_id, key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_case_documents_company_case_updated_idx ON public.pipeline_case_documents USING btree (company_id, case_id, updated_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX pipeline_case_documents_document_uq ON public.pipeline_case_documents USING btree (document_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_case_events_case_created_idx ON public.pipeline_case_events USING btree (case_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_case_events_company_case_idx ON public.pipeline_case_events USING btree (company_id, case_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_case_issue_links_automation_attempt_idx ON public.pipeline_case_issue_links USING btree (automation_attempt_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX pipeline_case_issue_links_case_issue_uq ON public.pipeline_case_issue_links USING btree (case_id, issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_case_issue_links_company_case_idx ON public.pipeline_case_issue_links USING btree (company_id, case_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_case_issue_links_issue_idx ON public.pipeline_case_issue_links USING btree (issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_cases_automation_attempt_idx ON public.pipeline_cases USING btree (automation_attempt_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_cases_company_idx ON public.pipeline_cases USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_cases_lease_expires_idx ON public.pipeline_cases USING btree (lease_expires_at) WHERE (lease_expires_at IS NOT NULL);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_cases_parent_idx ON public.pipeline_cases USING btree (parent_case_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX pipeline_cases_parent_request_key_uq ON public.pipeline_cases USING btree (parent_case_id, request_key) WHERE ((request_key IS NOT NULL) AND (retired_at IS NULL));
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX pipeline_cases_pipeline_case_key_uq ON public.pipeline_cases USING btree (pipeline_id, case_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_cases_pipeline_stage_idx ON public.pipeline_cases USING btree (pipeline_id, stage_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_cases_retired_idx ON public.pipeline_cases USING btree (company_id, retired_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX pipeline_documents_company_pipeline_key_uq ON public.pipeline_documents USING btree (company_id, pipeline_id, key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_documents_company_pipeline_updated_idx ON public.pipeline_documents USING btree (company_id, pipeline_id, updated_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX pipeline_documents_document_uq ON public.pipeline_documents USING btree (document_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX pipeline_stages_pipeline_key_uq ON public.pipeline_stages USING btree (pipeline_id, key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_stages_pipeline_position_idx ON public.pipeline_stages USING btree (pipeline_id, "position");
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX pipeline_transitions_pipeline_edge_uq ON public.pipeline_transitions USING btree (pipeline_id, from_stage_id, to_stage_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_transitions_pipeline_from_idx ON public.pipeline_transitions USING btree (pipeline_id, from_stage_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipeline_transitions_pipeline_to_idx ON public.pipeline_transitions USING btree (pipeline_id, to_stage_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipelines_company_idx ON public.pipelines USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX pipelines_company_key_uq ON public.pipelines USING btree (company_id, key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX pipelines_company_project_idx ON public.pipelines USING btree (company_id, project_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_company_settings_company_idx ON public.plugin_company_settings USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX plugin_company_settings_company_plugin_uq ON public.plugin_company_settings USING btree (company_id, plugin_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_company_settings_plugin_idx ON public.plugin_company_settings USING btree (plugin_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX plugin_config_plugin_company_idx ON public.plugin_config USING btree (plugin_id, company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX plugin_database_namespaces_namespace_idx ON public.plugin_database_namespaces USING btree (namespace_name);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX plugin_database_namespaces_plugin_idx ON public.plugin_database_namespaces USING btree (plugin_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_database_namespaces_status_idx ON public.plugin_database_namespaces USING btree (status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_entities_company_idx ON public.plugin_entities USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_entities_plugin_idx ON public.plugin_entities USING btree (plugin_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_entities_scope_idx ON public.plugin_entities USING btree (scope_kind, scope_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_entities_type_idx ON public.plugin_entities USING btree (entity_type);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_job_runs_company_idx ON public.plugin_job_runs USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_job_runs_job_idx ON public.plugin_job_runs USING btree (job_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_job_runs_plugin_idx ON public.plugin_job_runs USING btree (plugin_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_job_runs_status_idx ON public.plugin_job_runs USING btree (status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_jobs_next_run_idx ON public.plugin_jobs USING btree (next_run_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_jobs_plugin_idx ON public.plugin_jobs USING btree (plugin_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX plugin_jobs_unique_idx ON public.plugin_jobs USING btree (plugin_id, job_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_logs_company_idx ON public.plugin_logs USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_logs_level_idx ON public.plugin_logs USING btree (level);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_logs_plugin_time_idx ON public.plugin_logs USING btree (plugin_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_managed_resources_company_idx ON public.plugin_managed_resources USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX plugin_managed_resources_company_plugin_resource_uq ON public.plugin_managed_resources USING btree (company_id, plugin_id, resource_kind, resource_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_managed_resources_plugin_idx ON public.plugin_managed_resources USING btree (plugin_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_managed_resources_resource_idx ON public.plugin_managed_resources USING btree (resource_kind, resource_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_migrations_plugin_idx ON public.plugin_migrations USING btree (plugin_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX plugin_migrations_plugin_key_idx ON public.plugin_migrations USING btree (plugin_id, migration_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_migrations_status_idx ON public.plugin_migrations USING btree (status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_state_plugin_scope_idx ON public.plugin_state USING btree (plugin_id, scope_kind);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_webhook_deliveries_company_idx ON public.plugin_webhook_deliveries USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_webhook_deliveries_key_idx ON public.plugin_webhook_deliveries USING btree (webhook_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_webhook_deliveries_plugin_idx ON public.plugin_webhook_deliveries USING btree (plugin_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugin_webhook_deliveries_status_idx ON public.plugin_webhook_deliveries USING btree (status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX plugins_plugin_key_idx ON public.plugins USING btree (plugin_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX plugins_status_idx ON public.plugins USING btree (status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX principal_permission_grants_company_permission_idx ON public.principal_permission_grants USING btree (company_id, permission_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX principal_permission_grants_unique_idx ON public.principal_permission_grants USING btree (company_id, principal_type, principal_id, permission_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX project_goals_company_idx ON public.project_goals USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX project_goals_goal_idx ON public.project_goals USING btree (goal_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX project_goals_project_idx ON public.project_goals USING btree (project_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX project_memberships_company_user_idx ON public.project_memberships USING btree (company_id, user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX project_memberships_company_user_project_uq ON public.project_memberships USING btree (company_id, user_id, project_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX project_memberships_company_user_starred_idx ON public.project_memberships USING btree (company_id, user_id, starred_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX project_memberships_project_idx ON public.project_memberships USING btree (project_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX project_workspaces_company_project_idx ON public.project_workspaces USING btree (company_id, project_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX project_workspaces_company_shared_key_idx ON public.project_workspaces USING btree (company_id, shared_workspace_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX project_workspaces_project_primary_idx ON public.project_workspaces USING btree (project_id, is_primary);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX project_workspaces_project_remote_ref_idx ON public.project_workspaces USING btree (project_id, remote_provider, remote_workspace_ref);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX project_workspaces_project_source_type_idx ON public.project_workspaces USING btree (project_id, source_type);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX projects_company_idx ON public.projects USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX routine_documents_company_routine_key_uq ON public.routine_documents USING btree (company_id, routine_id, key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routine_documents_company_routine_updated_idx ON public.routine_documents USING btree (company_id, routine_id, updated_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX routine_documents_document_uq ON public.routine_documents USING btree (document_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routine_revisions_company_responsible_user_idx ON public.routine_revisions USING btree (company_id, responsible_user_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routine_revisions_company_routine_created_idx ON public.routine_revisions USING btree (company_id, routine_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX routine_revisions_routine_revision_uq ON public.routine_revisions USING btree (routine_id, revision_number);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routine_runs_company_responsible_user_idx ON public.routine_runs USING btree (company_id, responsible_user_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routine_runs_company_routine_idx ON public.routine_runs USING btree (company_id, routine_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routine_runs_dispatch_fingerprint_idx ON public.routine_runs USING btree (routine_id, dispatch_fingerprint);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routine_runs_linked_issue_idx ON public.routine_runs USING btree (linked_issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routine_runs_revision_idx ON public.routine_runs USING btree (routine_revision_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routine_runs_trigger_idempotency_idx ON public.routine_runs USING btree (trigger_id, idempotency_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routine_runs_trigger_idx ON public.routine_runs USING btree (trigger_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routine_triggers_company_kind_idx ON public.routine_triggers USING btree (company_id, kind);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routine_triggers_company_routine_idx ON public.routine_triggers USING btree (company_id, routine_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routine_triggers_next_run_idx ON public.routine_triggers USING btree (next_run_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routine_triggers_public_id_idx ON public.routine_triggers USING btree (public_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX routine_triggers_public_id_uq ON public.routine_triggers USING btree (public_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routines_company_assignee_idx ON public.routines USING btree (company_id, assignee_agent_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routines_company_folder_idx ON public.routines USING btree (company_id, folder_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routines_company_origin_idx ON public.routines USING btree (company_id, origin_kind, origin_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routines_company_project_idx ON public.routines USING btree (company_id, project_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routines_company_responsible_user_idx ON public.routines USING btree (company_id, responsible_user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX routines_company_status_idx ON public.routines USING btree (company_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX secret_access_events_company_created_idx ON public.secret_access_events USING btree (company_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX secret_access_events_company_credential_owner_idx ON public.secret_access_events USING btree (company_id, credential_owner_user_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX secret_access_events_consumer_idx ON public.secret_access_events USING btree (company_id, consumer_type, consumer_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX secret_access_events_run_idx ON public.secret_access_events USING btree (heartbeat_run_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX secret_access_events_secret_created_idx ON public.secret_access_events USING btree (secret_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX secret_access_events_user_definition_created_idx ON public.secret_access_events USING btree (user_secret_definition_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX smoke_run_steps_company_path_idx ON public.smoke_run_steps USING btree (company_id, path);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX smoke_run_steps_company_run_idx ON public.smoke_run_steps USING btree (company_id, run_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX smoke_runs_company_started_idx ON public.smoke_runs USING btree (company_id, started_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX smoke_runs_company_status_idx ON public.smoke_runs USING btree (company_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX status_card_updates_card_started_idx ON public.status_card_updates USING btree (card_id, started_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX status_card_updates_generation_issue_idx ON public.status_card_updates USING btree (generation_issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX status_cards_company_archived_idx ON public.status_cards USING btree (company_id, archived_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX status_cards_company_next_eval_idx ON public.status_cards USING btree (company_id, next_eval_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX summary_slots_company_generating_issue_idx ON public.summary_slots USING btree (company_id, generating_issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX summary_slots_company_scope_idx ON public.summary_slots USING btree (company_id, scope_kind, scope_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX summary_slots_company_updated_idx ON public.summary_slots USING btree (company_id, updated_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX summary_slots_document_uq ON public.summary_slots USING btree (document_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_access_audit_company_created_idx ON public.tool_access_audit_events USING btree (company_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_access_audit_connection_idx ON public.tool_access_audit_events USING btree (connection_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_access_audit_gateway_idx ON public.tool_access_audit_events USING btree (company_id, gateway_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_action_requests_company_status_idx ON public.tool_action_requests USING btree (company_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_action_requests_invocation_idx ON public.tool_action_requests USING btree (invocation_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_action_requests_issue_idx ON public.tool_action_requests USING btree (company_id, issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_applications_company_idx ON public.tool_applications USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_applications_company_key_uq ON public.tool_applications USING btree (company_id, application_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_applications_company_name_uq ON public.tool_applications USING btree (company_id, name);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_applications_company_status_idx ON public.tool_applications USING btree (company_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_call_events_company_created_idx ON public.tool_call_events USING btree (company_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_call_events_gateway_idx ON public.tool_call_events USING btree (company_id, gateway_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_call_events_invocation_idx ON public.tool_call_events USING btree (invocation_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_call_events_issue_idx ON public.tool_call_events USING btree (company_id, issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_call_events_run_idx ON public.tool_call_events USING btree (company_id, run_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_catalog_entries_application_idx ON public.tool_catalog_entries USING btree (application_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_catalog_entries_company_idx ON public.tool_catalog_entries USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_catalog_entries_company_status_idx ON public.tool_catalog_entries USING btree (company_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_catalog_entries_connection_idx ON public.tool_catalog_entries USING btree (connection_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_catalog_entries_connection_name_uq ON public.tool_catalog_entries USING btree (connection_id, name);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_connection_installs_company_target_idx ON public.tool_connection_installs USING btree (company_id, target_type, target_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_connection_installs_connection_idx ON public.tool_connection_installs USING btree (company_id, connection_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_connection_installs_target_uq ON public.tool_connection_installs USING btree (company_id, connection_id, target_type, target_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_connections_application_idx ON public.tool_connections USING btree (application_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_connections_company_enabled_idx ON public.tool_connections USING btree (company_id, enabled);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_connections_company_idx ON public.tool_connections USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_connections_company_uid_uq ON public.tool_connections USING btree (company_id, uid);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_gateway_rate_limit_counters_company_idx ON public.tool_gateway_rate_limit_counters USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_gateway_rate_limit_counters_window_uq ON public.tool_gateway_rate_limit_counters USING btree (company_id, counter_key, window_start_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_gateway_sessions_company_agent_idx ON public.tool_gateway_sessions USING btree (company_id, agent_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_gateway_sessions_company_expires_idx ON public.tool_gateway_sessions USING btree (company_id, expires_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_gateway_sessions_gateway_idx ON public.tool_gateway_sessions USING btree (company_id, gateway_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_gateway_sessions_issue_idx ON public.tool_gateway_sessions USING btree (company_id, issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_gateway_sessions_run_idx ON public.tool_gateway_sessions USING btree (company_id, run_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_gateway_sessions_token_hash_uq ON public.tool_gateway_sessions USING btree (token_hash);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_invocations_company_created_idx ON public.tool_invocations USING btree (company_id, created_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_invocations_company_idempotency_uq ON public.tool_invocations USING btree (company_id, idempotency_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_invocations_gateway_idx ON public.tool_invocations USING btree (company_id, gateway_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_invocations_issue_idx ON public.tool_invocations USING btree (company_id, issue_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_invocations_run_idx ON public.tool_invocations USING btree (company_id, run_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_mcp_gateway_tokens_company_expires_idx ON public.tool_mcp_gateway_tokens USING btree (company_id, expires_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_mcp_gateway_tokens_gateway_idx ON public.tool_mcp_gateway_tokens USING btree (company_id, gateway_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_mcp_gateway_tokens_subject_idx ON public.tool_mcp_gateway_tokens USING btree (company_id, subject_type, subject_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_mcp_gateway_tokens_token_hash_uq ON public.tool_mcp_gateway_tokens USING btree (token_hash);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_mcp_gateways_company_idx ON public.tool_mcp_gateways USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_mcp_gateways_company_name_uq ON public.tool_mcp_gateways USING btree (company_id, name);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_mcp_gateways_company_slug_uq ON public.tool_mcp_gateways USING btree (company_id, slug);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_mcp_gateways_company_status_idx ON public.tool_mcp_gateways USING btree (company_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_mcp_gateways_profile_idx ON public.tool_mcp_gateways USING btree (company_id, profile_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_mcp_gateways_public_id_uq ON public.tool_mcp_gateways USING btree (gateway_public_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_oauth_states_actor_idx ON public.tool_oauth_states USING btree (created_by_actor_type, created_by_actor_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_oauth_states_company_idx ON public.tool_oauth_states USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_oauth_states_connection_idx ON public.tool_oauth_states USING btree (connection_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_oauth_states_expires_at_idx ON public.tool_oauth_states USING btree (expires_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_oauth_states_subject_user_idx ON public.tool_oauth_states USING btree (company_id, subject_user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_policies_company_enabled_idx ON public.tool_policies USING btree (company_id, enabled);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_policies_company_name_uq ON public.tool_policies USING btree (company_id, name);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_policies_company_type_idx ON public.tool_policies USING btree (company_id, policy_type);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_profile_bindings_company_target_idx ON public.tool_profile_bindings USING btree (company_id, target_type, target_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_profile_bindings_target_profile_uq ON public.tool_profile_bindings USING btree (company_id, target_type, target_id, profile_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_profile_entries_application_idx ON public.tool_profile_entries USING btree (company_id, application_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_profile_entries_catalog_entry_idx ON public.tool_profile_entries USING btree (company_id, catalog_entry_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_profile_entries_company_profile_idx ON public.tool_profile_entries USING btree (company_id, profile_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_profile_entries_connection_idx ON public.tool_profile_entries USING btree (company_id, connection_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_profiles_company_key_uq ON public.tool_profiles USING btree (company_id, profile_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_profiles_company_name_uq ON public.tool_profiles USING btree (company_id, name);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_profiles_company_status_idx ON public.tool_profiles USING btree (company_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_rate_limit_counters_company_idx ON public.tool_rate_limit_counters USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_rate_limit_counters_window_uq ON public.tool_rate_limit_counters USING btree (company_id, policy_id, counter_key, window_kind, window_start_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_runtime_metric_counters_bucket_uq ON public.tool_runtime_metric_counters USING btree (company_id, metric, bucket_start_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_runtime_metric_counters_company_metric_idx ON public.tool_runtime_metric_counters USING btree (company_id, metric, bucket_start_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_runtime_slots_company_idx ON public.tool_runtime_slots USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_runtime_slots_connection_idx ON public.tool_runtime_slots USING btree (connection_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_runtime_slots_execution_workspace_idx ON public.tool_runtime_slots USING btree (company_id, execution_workspace_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_runtime_slots_slot_key_uq ON public.tool_runtime_slots USING btree (company_id, slot_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_stdio_command_templates_company_idx ON public.tool_stdio_command_templates USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX tool_stdio_command_templates_company_key_uq ON public.tool_stdio_command_templates USING btree (company_id, template_key);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX tool_stdio_command_templates_company_status_idx ON public.tool_stdio_command_templates USING btree (company_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX user_inbox_agent_policies_allowed_agent_ids_idx ON public.user_inbox_agent_policies USING gin (allowed_agent_ids);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX user_inbox_agent_policies_company_user_uq ON public.user_inbox_agent_policies USING btree (company_id, user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX user_secret_declarations_company_idx ON public.user_secret_declarations USING btree (company_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX user_secret_declarations_company_required_idx ON public.user_secret_declarations USING btree (company_id, required);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX user_secret_declarations_definition_idx ON public.user_secret_declarations USING btree (user_secret_definition_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX user_secret_declarations_required_override_idx ON public.user_secret_declarations USING btree (company_id, allow_missing_override) WHERE (allow_missing_override = true);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX user_secret_declarations_target_idx ON public.user_secret_declarations USING btree (company_id, target_type, target_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX user_secret_declarations_target_path_uq ON public.user_secret_declarations USING btree (company_id, target_type, target_id, config_path);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX user_secret_definitions_company_key_uq ON public.user_secret_definitions USING btree (company_id, key) WHERE (deleted_at IS NULL);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX user_secret_definitions_company_provider_idx ON public.user_secret_definitions USING btree (company_id, provider);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX user_secret_definitions_company_status_idx ON public.user_secret_definitions USING btree (company_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX user_secret_definitions_provider_config_idx ON public.user_secret_definitions USING btree (provider_config_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE UNIQUE INDEX user_sidebar_preferences_user_uq ON public.user_sidebar_preferences USING btree (user_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX workspace_operations_company_run_started_idx ON public.workspace_operations USING btree (company_id, heartbeat_run_id, started_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX workspace_operations_company_workspace_issue_started_idx ON public.workspace_operations USING btree (company_id, execution_workspace_id, issue_id, started_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX workspace_operations_company_workspace_started_idx ON public.workspace_operations USING btree (company_id, execution_workspace_id, started_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX workspace_runtime_services_company_execution_workspace_status_i ON public.workspace_runtime_services USING btree (company_id, execution_workspace_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX workspace_runtime_services_company_project_status_idx ON public.workspace_runtime_services USING btree (company_id, project_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX workspace_runtime_services_company_updated_idx ON public.workspace_runtime_services USING btree (company_id, updated_at);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX workspace_runtime_services_company_workspace_status_idx ON public.workspace_runtime_services USING btree (company_id, project_workspace_id, status);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
CREATE INDEX workspace_runtime_services_run_idx ON public.workspace_runtime_services USING btree (started_by_run_id);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Data for: drizzle.__drizzle_migrations (210 rows)
COPY "drizzle"."__drizzle_migrations" ("id", "hash", "created_at") FROM stdin;
1	4a168f2905beecf8aba7c8a051028ebae7c603a957520fe84295ef7138bf4447	1771300567463
2	217284002174a0adcbbb99716afcb92411151a947a8a487de7dcb83a70ba5607	1771349039633
3	9cbdf1229ed84d34bdd56f5b8c3b22675ee4bc1365dd64a944e904bc2424a5e1	1771349403162
4	f60c49b6ee7454c996a46b590e78b4c22b534981dc08d65d0dd722a46d337a71	1771456737635
5	86e2f6f9d47ba19103a637d886c302b272aac26ccf9ee9d4a321d8c352433182	1771545600000
6	7040dd156d41369d8429ee83c01274a28cf45e195ffbea967d9b96f3052d72e1	1771545601000
7	2b9151436c1ca83ae56c0a20915d229a8f22a1398db0f5e7219572026b804b22	1771545602000
8	e9f9a84e20db5e428ae9213b248fa51872cb2fb7db627d06d9a4f1506a502ec9	1771545603000
9	d04b3303685364349c205964578bd5c4d62abf81dea54d971168c1bb6baa5b87	1771534160426
10	2c560d142857e22379831a7bcedadd3dd44e02f363b80ca5abdca9eec22c18a5	1771534211029
11	0c2be1ee431b088695ab3d1f1471d50f8fb619701b50b3c6a6beef725307f82d	1771605173513
12	06ef4c6d69108b55a7d618d76d4fb020e51a717d7519995f933b9ae021154659	1771616419708
13	363da95d93bf8f1e3f2c9d046684d66578b494e8cbadba6642432ea6db52b7a2	1771619674673
14	00e91acdaa63469f002158dbda1a2ff7362d41da4de334fe1e198482c8eaf9fb	1771623691139
15	cd2de941d6fc0f7fea6bb44fa41b978e88300e3ef3af68713aa57c6ea2a70241	1771691806349
16	42b5f5c8ea4f81988a6064b2eb8491c74847a4279ee5a5f3255cd69966dc9877	1771865100000
17	949b6579d20aca89afb8efc0375e705a1b6a275e9d7cec5ff9ba2eebf24ef88d	1771955900000
18	7b8bc0a9c03438b78611e5601cba48222bfbc6fcee08aa9594f172f558b5aa29	1771883888199
19	96712cb18db3f02e74ce33aca6d0a2ae52d7216964387b4e507e705ef07837eb	1771897769629
20	d07a384240e032c84ee5efbf040b12e78b3e670398dd39d5cf0157679b2a5b3a	1772029333401
21	2ef0a0fd958cf0c96df485ba8b3fff06dbed85c56a043991231a0d5258eec209	1772032176413
22	e5f5ec21df5031056ed92874dab3c770435ff092e3f8d15e7b07803ff29bf9e5	1772122471656
23	2e627668cc677920c7fd5d02f4532be3e253c9c80790ceb97711792a110122f4	1772186400000
24	484e5c7d805eb96ea50b7f808bba8df2b9a4120f4e1452a97ae18c9468a1944b	1772139727599
25	40ff648f3bc91a9a733f070db7e02649633485db4f91eda404f0612a0ab460d6	1772806603601
26	eb01d64ec77c03859269e370af4850092fe592944f3cf1fa6ad4695cb0b3ab17	1772807461603
27	605fae9ea9f92718a263550180e9102dc8f53d58827b236b8c6a3453cb0e9c64	1773089625430
28	d434c7ec995d048f812a74d248e36797eb77e597c9d4b942808f2ee4c53ef3d8	1773150731736
29	68a66cce12c03e2e46f84d7a0a282e502b9f9d26e9b452e31b79f6c860928640	1773432085646
30	893ff5bd4351dd79a5c51658beac7cbd6c92d1247eb76ac6364c87f763a4c8e2	1773417600000
31	ec7e4985166e9cb3abcb9ccaabf3d79771e96ccbaaf789028f9e5120044af51a	1773670925214
32	7ba5b686d334d3c0efbe6283ed9bb75aab35498c0b1b6fc363716e90b5572256	1773511922713
33	cc46d46a7167c57d3373827e6cf79d0807c093e29fb3ad90ac0092b42dd1deaa	1773542934499
34	d4616d35c778c192e8a46d8b6b5942fd95ede5ed3f8dbc95c276221539fe8b0e	1773664961967
35	b3e8c916f07608ad6ab220df5783c49d6d76e5640042ee1b2a64f8f2dc27189f	1773697572188
36	e79ecacc261720c947b887a45b5ed99bd6bab8d924e887fe98336a24e636ca35	1773698696169
37	f224c54bc3a5cea815854966d5ebab451eecc9fa4d1b9a1880efdf43c424cac4	1773756213455
38	8a8c9b444812583524c2776edac092cb9b8c05ba1ee7fa89241789d9e7a69272	1773756922363
39	359de5cfcaaaa5f4362f47f158e8a4d97d145896f6052ff118f44e23a2bae6b6	1773931592563
40	dd1854c43854dd238055dc6ed9bcd5b06f43feebc0fbb8306766e7292f19bc04	1773926116580
41	0b14055c4f5617b8b944b8e15d51472cd919be335881aa63f942677ad19c56ec	1773927102783
42	5bd65ef2947bd724b0ae5495db4527f4f191225a5fb425925f79294ebce7a03c	1774011294562
43	3772e9aada1d394b95cc588ac8e3756da7a5f57fcad8e9f661f96b4303820f53	1774031825634
44	e1119e9fdc94b36a0d77f806980a6d987b2d2e75b299727d1a5b02c9f8de03c8	1774008910991
45	d0dda5d7787eff4aefe1ece4e6d25b7947acd08c95e80fa34b170fd1474a04ab	1774269579794
46	fe897560c8d543587b37891f0b422b7c334ed9a6a10355c86bd4fbce566c5454	1774530504348
47	278631f7fd69ff46fd4d0b54c876fa81b317f7409c25790adb05c910b9a1dad7	1774960197878
48	31ef6263f4dde97af16f2fbcf520646883295cc852213cfb99062eb504d349f9	1775137972687
49	5b6c43f3d2b5fa8a1998cbf14bcbf6ee0c5067317d539e20b13b6487d48b8d42	1775145655557
50	7d25e72a806b086a94e6f548e764a7393f1e4d917c9afcee4d051e54643028fc	1775349863293
51	0432fd6dda492288eea238a155ffb46e146bbe55efac99ab81a99a290bb528fb	1775487782768
52	b6467b62ce525d470df92b97b0678c2568ae9d1ba8e6ca9d8a48ca2597899501	1775524651831
53	27fb10df284e95ecdf9e4029efa4df1a3b381b4073b9eeffb59b53cf4abc8c48	1775571715162
54	f8ec8fad6aa7bca5068720c2f0a4ea74efbafc40f53ad709fd31b8727412457c	1775604018515
55	f21d1da197bb83eced58f6074e9ac74e003b266afd51eac0cfafe0c2083af1e8	1775750400000
56	d7b227b28f8ea3621cedcee0ec46d06203a9a75872dd48d181bcf8eef8d7cec7	1775825256196
57	f305ae7da5d1b5df1701152ef2fe9b200cc7c1c50814c08cc274ca1e9d9a150b	1776084034244
58	cb435f82a01b567b72e27ceed83e3049502a2b284a08cfd32275e912c2f51741	1776309613598
59	f0b1525c737e32381bb9f5bef42751a08703b3e5cbf67128a13bd4de342bfcfe	1776542245004
60	578ea35e2a3c828dec0c666305b59aaf6f16035be160a53a4bfc6d4b7eb7ad83	1776542246000
61	a1467b361ef79eb72a49d9474111775b2baaec62d86f98591c239658250e4c15	1776717606743
62	da9b4301a9d02f5f44d173c595341d5a651b7a176837118d48df4ce5cd603b23	1776785165389
63	7ccc4880585927e45a2100c9faf0be169f198859e9ccb48102d8cf430138cc9c	1776780000000
64	a5859c4305fdf8719d4d1949d44e7029242286efb46a7ba7c4e5c5343d77ade3	1776780001000
65	9e32e1e4a4dbd752ff087f5672de594668c3485553262a80257ca480286170fb	1776780002000
66	280988e07dea328fe9815cb8c80dd16691ac1427ff9069cd2118038d4b2bb5cc	1776903900000
67	1a5aadd183ecaf557ee23801ceb9725a6d56dab78a4e4df539280b551ed82ef1	1776903901000
68	a1e43ea1a68770252d36ff1a5c00e660dcbea2a05222559ab3d6b4ca84ed2ea9	1776904200000
69	bbcbf800852e0e8f992db48b4653af73cd0478e494cbb71439f0ad664cc12cb8	1776959400000
70	fbc93ff9b93ad70bafe93cc44ac231ef73a6ea91983a4ab2e1b128ea9f8bd4a1	1776780003000
71	132aaa7a1ce516b815c26985a390ef78a1632730b939f82543fa8ea0e7b0246f	1776780004000
72	3b19e1d26124a927d13adc090864357667e3d73dac33a85594fe7bb0fdc610e9	1777131234000
73	008c2aab9a0e319f61018f2e7b4748e1454e24fa974eb404692fb6f4eac17cec	1777305216238
74	cc105a068340f86984758d5b012343d7bfb3bf85fc636d93381361ef6f88270f	1777382021347
75	5b4f58288af4351b14fce3e066255d8075e7a5a9732638b3038c910ecee00866	1777384535070
76	dc1f8c66a5088068819954aadff948e5bde26b2d7c3222f27f0ebb649639f144	1777572332006
77	601931acc7e344c9738f4ff52a64f9aae544c9c60c4292eb73e6fff5cd916f12	1777675301279
78	48fe3461dd7d75e0bf8d66f260f480d5cdad40895314352d5dc41e62cded344e	1777933347806
79	11573ddf41de1208831980dcbfb143922bbb374fe4e20ba5eaa96f6820033767	1778004024976
80	2b5a14a99abf4c6cbd753f52d806b8a999e4fb03a95b00493873f2c1227745a9	1777821410992
81	49c738698d5efa84a54c06def568721654d399427d4ae4ff05fad2646a0a3e1e	1777849000000
82	79676a9996c0a8979ba19812c10393961d361ced758fa14d447d346300d8b334	1778067785040
83	2b6660781a0bc51fb4b255ecf90bd1a533888f6514114f324bd86e3c40b9bcb5	1778067785041
84	a97be2bb8f67b0f5cf2782d43ea01d6ca8117e4b78bf600c9ebf6e9250578685	1778074536410
85	84ea5e794c63599a55fc15fbb4c9eaa098bcc0da4d4195ee515d4c3ce702cf51	1778355326070
86	f9852e06c19b1ff4fcebb34bcda456d2995fb24beeac5b70432deee9b6d7b229	1778787362162
87	8ca00a87e4b1ca0b43411534f1218ca8b46ba0f601caa2159b33b9c1c6646e59	1778976000000
88	7a723ac2b61af1182f78a6a22af028a8bca4511b1a8f977eaecdd2131c80504d	1779360000000
89	4decca1b322d15430512bec78ae3b5caecaf5ea7a3754f5f7608ed3f0d59fe0d	1779446400000
90	2a71008cbd4f11e8301d3d8b88431681ddc27c0ad8054484f1af01506a06f62a	1779129600000
91	e044d13426fa26e95175cffe7e4f058a19052b4f55bbbbacc2ba6755bde20175	1779573019125
92	3db3cadcf2d0720a3c7c3adbe20d841f60f9361729204bbe1246fba46bd195b2	1778810394522
93	c579402bcedfd5d380726b686fac9de79f5b6cdfcb25fc4520511a5887bb5149	1779999768200
94	8524a4ba6635512364f7814d48d4fef98b08cb7edcfe9de290d333586a841fa3	1780040470886
95	371e08277bee0124438802f192b2e4dd01dff7956f0eb2451eac841f80bcac30	1780533900000
96	f067265dd6fc675bd0522f575ae2ef3607568538c190cd94281ef2dc824c6af8	1780507597454
97	531673a6d8a7b9a448e3745874daeecfa6af36359c7dd44927860f22e8fd7ac5	1780507597455
98	97ce068d4819ab1e9fc7f1849c2d7e6eeb6adc72a361450eb77af8af527446ee	1780534000000
99	9ec97f5d6513e1eb9de764b04cadbb49935eed4afab1b67f1a2e5257beb1729d	1780534200000
100	aabfee13a3ac7dd59342a7f2398dbe1a6c87e75fcaead1f08f9d1a77fc829b3e	1781130000000
101	9ac7e19e6a5a8eb6fa8c3ab5166a046306ed3e028fd43ad78b4367ca0f16e1ce	1781480000000
102	ed4ee607e26dd12cdfa491985360abd5de698997adefe9b77226c5274ef9b333	1781490000000
103	24b91cd38c63c70953a8653ed30ab1948a163a684056fe59718104e6a066e13a	1781490100000
104	9866d69c19e1e68647f9afb87fe1c40044a9a3657771b442decfb58a22d442f3	1781490200000
105	d2dd64cfcb2125552b132a301bad2c0b27af76db8a33137689b4a31397e39192	1781733000000
106	a24935c1f8e9a244fc27240f6379d818f0006ce1c8f55906131c34511d5bb2e9	1781902000000
107	4def4f4d44b38a6db75141cacbb3762f976191ce97d95acda76bca993288d586	1781902100000
108	dd410e04746f3952997e83cd22a5d90129919676149c71c5e4f3914fa01361e9	1782165200000
109	fab257c41a95fbae8196d802bad35e1db05e1123c133f2961150a2a3b79fab1f	1781902200000
110	e3086f4da253c6965b0a54c0532b6b16139c870fda7a0838f76b778b85708c65	1781902300000
111	bd980c083453ee6e009694950c97e92c751b9d0d440a7776b855b76d61719027	1781902400000
112	c20c975d288f6afeea24658f07030b86992cebf03852dfbec7c50a1f052642b4	1781902500000
113	0969f2f5bcd1468f39bc08a6f08035c43be1503f4f7de78dc66827a8ba7b8f1e	1781902600000
114	c0156b2cf2cc87932d840c30d252a185143c8be67d250cfd6d686948d0531fc1	1781902700000
115	e9b0149172f59ce1524dce011c1f2637ab23d7271f92f3682e9ae3c5b56bf4e7	1781902800000
116	f08433ee3e7126d56abffa9d1305512b62627a301450f331541fdaea8b399e6e	1781902900000
117	b297028be5a5f23f4e55441062182146ce312e9e58ab807c529744839ceecb95	1781903000000
118	01b7fb1d1e9325a7ad482ec3ccaae8ae96f0277a5c62667e21880dd700954ac5	1781903100000
119	5cdb096ac90c1f1287d3ccd245bd8005749e66f4e5c7ed2686937e9b46fc3ec2	1781903200000
120	032e13b12757813e9149339e199a6f74d0be32763ec126c0fecfe66a745703bb	1781903300000
121	b1a32f697fe739185c03ce695906ef962d263144bc4ae413e0b9685b24fc595d	1781903400000
122	cd74d31745d9eb497577b1985a90fbb5e53a1af1e00a8272ed527c9a85709bc6	1781903500000
123	eead2cf41c1ac1e3413f6f56ef556b9c8895f40c1be84571ad313bcede68c36f	1781903600000
124	858a19e7b436cd064fbf3c5462fee3055653667d336a2620a2c18a4a5012455a	1781903700000
125	93ff6c94e14600c5f0e43aec79ce02b04cb344b2d1791df190c59a771a08e99f	1782440000000
126	6e7bb3ab7b6fbf9926d79a1ead40e205e1bb26d08f5ddcd93cbfa64cca1d6001	1782440100000
127	d8cfa7214ff61af7d8a1d7219e1d13a93017b825df14b9061fc0faa3d5a70fa6	1782526500000
128	2d9414e39118d66da51a1c314deb040ffc845ae8d56fbfb1ab4c309f37facdc9	1782923938661
129	a4a8e487517fba73b569a2f9aadbdf870b77a34e01b8bea0a43c3d4c88ce2a50	1783025124120
130	658a85151f870f1f89a3d3de61cde0f1b39bbc99a35c4bb27710590762d65a8d	1783025324120
131	80408941e435179af5441ec3c8207d7e31a78520d1ff8d18f3b8fe879ebde17d	1783025424120
132	c2a7336b58e93aee41c48ffcf9bed6a2ca6255407a9e49b493ddbdf6deccc3b1	1783034521000
133	563b78f4ae4eb586820ecb9cdce5994b64ee840a6edc75e6a0e7feaf1f184630	1783025624120
134	fbe54ea1f702caf6241850697cbf6519e7d114641126db6ef469f38375c1815d	1783025724120
135	c9b2d8c4fbb751d67ff118ba66ce7efb6583346bd8883e1a69b62565b48a29b6	1783555200000
136	7a040c0e0a5b8924ce9d82eadfd324d811fb9f290b28eb4fa882fe0ac9f551b3	1783555201000
137	e1942e00e81f24b0fbb0f5ba38d87962182bc6be529a70fde7f071dc311e5ebb	1783555202000
138	bc9f1e4e1a969d08b667fffab14fe9ae3a94a13fc194d0749dedc12cff744165	1783555203000
139	60b0ee743270249998b8c49660cb13930dccf65ebb38fdf01c281d7a9c59e79f	1783555300000
140	a92ce792c68668f356a20240faf505d07be40bb9e097b36c38335904555605c3	1783555301000
141	bd362aced33dfd3cf0f1af3c9db98b9628966908e011ece41c5c0704524b0114	1783555301100
142	19ea6be1aeadfed222822c3dfbfb504015ecd67744530e0e6f778a4ddb228dbe	1783457051766
143	670ba6343ceff77aefc892fe69b91fac7c73c79bb4f0b4bcb4e767966d914944	1783520000000
144	2fb01e46ff5adaf34ca84865d108621216d53b8009f30da42956dd4a5b80932a	1783641600000
145	a5ad7d285f6c6ad19f2980b046ec74189a8e7b96c930175d78af73d7c3758c4e	1783822632557
146	c97f6de83f6f45247122b71669322a52e025ca9ad896a74375bc993f386d50c2	1783953514660
147	59c99b0728610e2e7ea7f29a62364e6121e2cadac747b83c61735f355d4b38c2	1783953515660
148	973497276131c631680c1b265b8d9d9110c3207c9eb066b1854426e4ca08347c	1783953516660
149	8ef76e87a40cab9ab5e7fd4fa114a91f29527e525837a043df1a74bebb133938	1783953517660
150	db417e1c46c824c4282ec3bff4572ca816b554e2fd130acfb1ad698e78001f48	1783953518660
151	75ab3c38858e08b8ccc3b58704c449ffba67257a4904cc6ec0caebed444a0f35	1783953519660
152	7a446cd93a5b49228058a8ff999231497fceaa0bd95f960dea9d8e6a113da37f	1783953520660
153	f42d9ed58ab8ebe52a880d6fc01013f785ab8a25c447293acca9d1ed57ad5584	1783953521660
154	63d5854c39bafaca62c7e2ad22253b6d3b0590403b1438b5ad38a594f0cf113c	1783953522660
155	f47da5b40228b23f7aaab712b3c915fbf08876e013cea75ee76af938972fa429	1783953523660
156	adb9256f4b32c7f73c738f89be8e0a3fe43cfd84f95cb6b833e81f0134adfaf9	1783953524660
157	ff7836f9082ed761cdcc9a6040ab4ea664295b959994d4db279dd286934d00dd	1783953525660
158	861b2e582fbb645c2982654fdcd9094f93d1c41c43527fb4787fff2bb3270fa3	1783953526660
159	83f11418a9186bde3730d2539103123b03f73db1e9c16770a7e1aa2bdf03fd2d	1783953527660
160	cad090ef744bc10a6cb6a7ae4bf83dce3e577dd0522d140a4b7269b11908fee2	1783953528660
161	57184b1fded85bfaa8db52b7cd80defd6383b246d987ded9954100d33aaf290c	1783953529660
162	3f9c079cbdf1eb26e6b3568b13443376192b064bf316e0286456806d8730afcb	1783953530660
163	7bebb273adc3938b535366249fab60af88ff842cfff27618ca026156bc61fe7a	1783953531660
164	0a3d602fd1949a57b11bc83d72f7514ad2af41b9bf81ef38d167d00f0abdbfa6	1783953532660
165	1316a83524f3c2d237a8c0dc101a63f3ec8a222816bd2d7fbc1bfc0174f38552	1783953533660
166	c6c8c249b787885d59cd5ef0d7f65927f2b42bd08f9d9273fceaeebabc2e8933	1783953534660
167	9c9c18ac797dc0b041c8a613594a1a20d5e7299d8e2ea374971909a256e368f2	1783953535660
168	adc841c1cb58927750ef6ad32e4a38262d69a58596db4c9b00e7adac406662e9	1783953536660
169	d2e85c848a1f56d9cd654b644fa51e137d9925ef4ae7f8dea0258ad7bd6db1a7	1784037600000
170	6d19e7c22629a90a0fd660b79361f211225736817e5c9d9d7daa05b494325b95	1784160000000
171	db36bf2e1ccf72c9681edc5bce1af24c64d2eadb486b1817ace7c85e2727ea17	1784169959628
172	a4a1d0ebc11d81c59653b35d2daf8c874f45b8cf2cef836eec4ba2114bbcd642	1784210753027
173	8483f2d9441b96cbf567a72f3728cda020940b2d18fb2a595775b62f995b0ed5	1784210754027
174	be7e1e3b63c65cf227ce1c84f5282706e6b006edd0bdb923cf93bf8dc2e86060	1784210755027
175	119867da6baf0e9c6adef3387d640da7bbbed80bbcbb0fb88e35bd53371af953	1784211956161
176	1eb4a204a06a54db7e887ff26c9adc4996059a904aba5592806a2a4bdbad051a	1784241826832
177	bd21302a0c52cd29557fa4da8cabc758be52a2f2e87228a42e4fde019d1feeb0	1784241827832
178	33063c60038f2ac962241d9ad511b71b2269488d3cf41872c9023ffcd22052c7	1784241828832
179	b578d26f5691fab742b68f4a34b2cff37329906b1c41127f60bbe8506d397ace	1784216720808
180	5d783cbc61dd0522b91e18c7858415aafc1f5474d7aac32a1456a216e402ac85	1784231633059
181	16ea6b8bbbf6000e26453ecc4f614e52830a5c6d8258dbf0f1ef0b743540e88c	1784592000000
182	34fbfbca813c54004579aa5041042ea30a2b7e7ab82a185efe510de1720c5286	1784653200000
183	fbbb9c10fff4cb62ad05a8eda39afb61180ba6184d8a1ab0661a9857ad79dda7	1784822400000
184	c74b799ef4bb7a3de742fdbb193b9a417e351c9ecb16045d104bfdfbcc42d540	1784826000000
185	721337870aab9a7164b2687d0924e0dd35ae3a4e56b580233715135ca679ba31	1784829600000
186	df2cc510cdd759e0ac34b861489548f6569bdc6fca979f141cdc4dbe0b5f9acb	1784833200000
187	f8aa6f315f346afc9837322734aa58d4c6b9e50a0489623a0bc5a1025b958782	1784837337101
188	d04fe363ca70427d1be21ac04fe7f66307361e6aa099205a30df16c80bffedd4	1784840937101
189	63e911b48b78288908f808fbbe3e9da8fb8991a5a14bb813def82b9ce65f8104	1784916885226
190	b8341e262a2b600be6e75b1d8a1f1e1a7a46ce55ecacd14c2ac29407fa7023d4	1784916885227
191	0a5bba629fea3d9a2929f2f568171e7c87e6ba9040c068680773e83742eb7a5c	1784916886226
192	7fdf9adfb1c4235128c6a806434da0f2050c199d323b6eeb8fc26cd49a0d28bb	1785170000000
193	e76ee70f3968e0d6268acb64a561fd93e3ec33b3aa6301d52f5391aa09853b65	1784920485226
194	956efc2dbda881521876b8deae835652079f407462596f230998d86f5fca26a8	1785170000001
195	41d1886d8b00f8484b27108e4538d219d9ed77fca10e6ad3006d9558dd9ec28d	1785170001001
196	65da7612683361ab5c7c8362ffee6e2a863433cc7eda3712b9b8f3fc507c848a	1785175200000
197	d48baf9a0240fe1ee0b071f4cbfc49cc36edd154760c9566d8064d510229862e	1785603158310
198	49d1f187dcdb87462299625c8ac733fa5a9b9d7f328b0697931090a5803f597c	1785605818353
199	e270a2c71fc3cc115be52873decb60cc4089d9029d328fa6ac083fb7dce82dc9	1785635155420
200	a4856727cf49bf0a2c0f862929cf11790a369a31ee4502c6a15890210d8f9e88	1785701828695
201	9b0346da3c4d48177d60d385e7f4c5255abc72ef9d3687b75dada0de994c86ad	1785702264747
202	1880b804c5cf748d7b9fddfc79d21d55c7c4372ef1bf687c6b95a2a595886eea	1785702264748
203	07b288ec749d4a972621ff257d3de8a45574cc40cc3935f463f83a3c0e575fc3	1785702264749
204	91290b03590f77d8e9a98138ef039db29fa63c687ae3114573e72cbf8ddf651c	1785853648731
205	2422b1c6e1f97a7eee6d2a8c8e2904c6a7c4af6af1ad22920bf33526434b5fd3	1785853648732
206	335414dc280f133e43280873d072d6cad6282a88261c1537fc186f0a869b4d1a	1785903493352
207	75ca778c2a9772ac4645e977b60907554ae95261c172af54cad54fc46f265529	1785988680096
208	442eec68b079796adc3be617e11dbc172943d1964926050e1e48cf7dae6cc709	1786020026023
209	51fab2cb2112fa5c0e2cb94eb7d07ae2e82ef96f39aae32af0766f49db86d70a	1786032087897
210	9e0a9fb9f4a1da0321224c964ed50f758851cee9a319963922235fa4cf9484f9	1786129601533
\.

-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Data for: public.environments (1 rows)
COPY "public"."environments" ("id", "name", "description", "driver", "status", "config", "metadata", "created_at", "updated_at", "env_vars") FROM stdin;
41108ba2-fbf6-427f-bc58-e2726ddaf4dc	Local	Default execution environment for Paperclip runs on this machine.	local	active	{}	{"defaultForInstance": true, "managedByPaperclip": true}	2026-08-28 11:10:40.611294+07	2026-08-28 11:10:40.611294+07	{}
\.

-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Data for: public.instance_settings (1 rows)
COPY "public"."instance_settings" ("id", "singleton_key", "experimental", "created_at", "updated_at", "general", "default_environment_id") FROM stdin;
78c014af-2c0c-4a82-9d3b-16f75a79f31f	default	{}	2026-08-28 11:10:40.611294+07	2026-08-28 11:10:40.611294+07	{}	41108ba2-fbf6-427f-bc58-e2726ddaf4dc
\.

-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Data for: public.instance_user_roles (1 rows)
COPY "public"."instance_user_roles" ("id", "user_id", "role", "created_at", "updated_at") FROM stdin;
2d7561d8-2dc0-40a4-bab9-222959ce6bdd	local-board	instance_admin	2026-08-28 11:10:48.180151+07	2026-08-28 11:10:48.180151+07
\.

-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Data for: public.user (1 rows)
COPY "public"."user" ("id", "name", "email", "email_verified", "image", "created_at", "updated_at") FROM stdin;
local-board	Board	local@paperclip.local	t	\N	2026-08-28 11:10:48.068+07	2026-08-28 11:10:48.068+07
\.

-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

-- Sequence values
SELECT setval('"drizzle"."__drizzle_migrations_id_seq"', 210, true);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
SELECT setval('"public"."heartbeat_run_events_id_seq"', 1, false);
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900

COMMIT;
-- paperclip statement breakpoint 69f6f3f1-42fd-46a6-bf17-d1d85f8f3900
