CREATE TYPE "public"."capacity_unit" AS ENUM('SEATS', 'TEAMS', 'ENTRIES');--> statement-breakpoint
CREATE TYPE "public"."checkin_outcome" AS ENUM('ACCEPTED', 'ADMITTED', 'ALREADY_USED', 'INVALID', 'REVOKED', 'DENIED', 'WRONG_EVENT', 'NOT_YET_VALID', 'EVENT_CLOSED');--> statement-breakpoint
CREATE TYPE "public"."event_category" AS ENUM('TECHNICAL', 'CULTURAL', 'E_SPORTS', 'MANAGEMENT', 'LITERARY', 'SPORTS', 'WORKSHOP', 'INTERACTIVE', 'RECREATIONAL', 'SHOWCASE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."event_format" AS ENUM('INDIVIDUAL', 'TEAM', 'EITHER');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_status" AS ENUM('PENDING', 'COMPLETE', 'RETRY_REQUIRED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."item_type" AS ENUM('GATE_PASS', 'EVENT_PASS');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('SUBMITTED', 'PENDING', 'ON_HOLD', 'APPROVED', 'SUCCESS', 'REJECTED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."price_model" AS ENUM('FREE', 'PER_PARTICIPANT', 'PER_TEAM');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('AWAITING_PAYMENT', 'PENDING_VERIFICATION', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'FULFILLMENT_FAILED');--> statement-breakpoint
CREATE TYPE "public"."scoring_status" AS ENUM('NOT_APPLICABLE', 'OPEN', 'DRAFT', 'FINALIZED');--> statement-breakpoint
CREATE TYPE "public"."team_member_role" AS ENUM('LEADER', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."team_member_status" AS ENUM('INVITED', 'ACCEPTED', 'DECLINED', 'REJECTED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."team_status" AS ENUM('DRAFT', 'READY', 'LOCKED', 'CONFIRMED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('ACTIVE', 'CANCELLED', 'REVOKED', 'REPLACED', 'USED', 'EXPIRED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."ticket_tier" AS ENUM('GENERAL', 'STUDENT');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('PARTICIPANT', 'VOLUNTEER', 'EVENT_LEAD', 'LEAD', 'SUPER_ADMIN');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" varchar(32),
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"ip_hash" text,
	"request_id" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_in_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"scanned_by" varchar(32) NOT NULL,
	"context" text NOT NULL,
	"event_id" uuid,
	"verdict" text NOT NULL,
	"outcome" "checkin_outcome" NOT NULL,
	"notes" text,
	"device_id" text,
	"request_id" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esports_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"match_number" integer NOT NULL,
	"participant_a_id" uuid,
	"participant_b_id" uuid,
	"scheduled_at" bigint,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"created_by" varchar(32),
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esports_score_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"score_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"changed_by" varchar(32) NOT NULL,
	"old_score" integer,
	"new_score" integer NOT NULL,
	"old_version" integer,
	"new_version" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esports_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid,
	"event_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"round_no" integer NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"recorded_by" varchar(32) NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_form_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"schema" jsonb NOT NULL,
	"published_at" bigint,
	"created_by" varchar(32),
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_staff" (
	"event_id" uuid NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"role" "user_role" NOT NULL,
	"assigned_by" varchar(32),
	"created_at" bigint NOT NULL,
	"revoked_at" bigint,
	CONSTRAINT "event_staff_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"category" "event_category" NOT NULL,
	"format" "event_format" DEFAULT 'INDIVIDUAL' NOT NULL,
	"fest_day" integer,
	"short_description" text,
	"description" text,
	"rules" text,
	"venue" text,
	"organizer" text,
	"eligibility" text,
	"timeline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prizes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price_model" "price_model" DEFAULT 'FREE' NOT NULL,
	"price_paise" integer DEFAULT 0 NOT NULL,
	"student_price_paise" integer DEFAULT 0 NOT NULL,
	"is_team" smallint DEFAULT 0 NOT NULL,
	"min_team_size" integer DEFAULT 1 NOT NULL,
	"max_team_size" integer DEFAULT 1 NOT NULL,
	"capacity" integer,
	"seats_taken" integer DEFAULT 0 NOT NULL,
	"capacity_unit" "capacity_unit" DEFAULT 'SEATS' NOT NULL,
	"status" "event_status" DEFAULT 'DRAFT' NOT NULL,
	"scoring_enabled" smallint DEFAULT 0 NOT NULL,
	"scoring_status" "scoring_status" DEFAULT 'NOT_APPLICABLE' NOT NULL,
	"leaderboard_public" smallint DEFAULT 0 NOT NULL,
	"volunteers_can_score" smallint DEFAULT 0 NOT NULL,
	"max_rounds" integer DEFAULT 1 NOT NULL,
	"form_schema" jsonb,
	"registration_opens_at" bigint,
	"registration_closes_at" bigint,
	"starts_at" bigint,
	"ends_at" bigint,
	"created_by" varchar(32),
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "fest_days" (
	"day_number" integer PRIMARY KEY NOT NULL,
	"date" varchar(10) NOT NULL,
	"valid_from" bigint NOT NULL,
	"valid_to" bigint NOT NULL,
	"description" text,
	CONSTRAINT "fest_days_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "gate_staff" (
	"user_id" varchar(32) PRIMARY KEY NOT NULL,
	"assigned_by" varchar(32),
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"scope" text DEFAULT 'GLOBAL' NOT NULL,
	"request_hash" text,
	"status" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"actor_id" varchar(32),
	"from_status" "payment_status",
	"to_status" "payment_status" NOT NULL,
	"decision" text,
	"reason_code" text,
	"notes" text,
	"request_id" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"payment_method" text DEFAULT 'UPI' NOT NULL,
	"transaction_id" text NOT NULL,
	"status" "payment_status" DEFAULT 'SUBMITTED' NOT NULL,
	"submitted_by" varchar(32) NOT NULL,
	"reviewed_by" varchar(32),
	"reviewed_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"item_type" "item_type" NOT NULL,
	"event_id" uuid,
	"team_id" uuid,
	"beneficiary_id" varchar(32),
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_paise" integer DEFAULT 0 NOT NULL,
	"line_total_paise" integer DEFAULT 0 NOT NULL,
	"tier" "ticket_tier" DEFAULT 'GENERAL' NOT NULL,
	"description_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"holds_slot" smallint DEFAULT 1 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(32) NOT NULL,
	"buyer_id" varchar(32) NOT NULL,
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"subtotal_paise" integer DEFAULT 0 NOT NULL,
	"total_amount_paise" integer DEFAULT 0 NOT NULL,
	"payment_method" text,
	"status" "purchase_status" DEFAULT 'AWAITING_PAYMENT' NOT NULL,
	"reservation_expires_at" bigint,
	"fulfillment_status" "fulfillment_status" DEFAULT 'PENDING' NOT NULL,
	"fulfillment_last_error" text,
	"fulfillment_attempts" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"paid_at" bigint,
	"cancelled_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "purchases_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "purchases_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"team_id" uuid,
	"participant_id" varchar(32) NOT NULL,
	"purchase_item_id" uuid,
	"status" text DEFAULT 'RESERVED' NOT NULL,
	"seat_count" integer DEFAULT 1 NOT NULL,
	"form_version_id" uuid,
	"form_responses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confirmed_at" bigint,
	"cancelled_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"role" "user_role" NOT NULL,
	"expires_at" bigint NOT NULL,
	"revoked_at" bigint,
	"ip_hash" text,
	"user_agent" text,
	"last_seen_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" varchar(32),
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" varchar(32),
	"invited_email" text NOT NULL,
	"role" "team_member_role" DEFAULT 'MEMBER' NOT NULL,
	"status" "team_member_status" DEFAULT 'INVITED' NOT NULL,
	"responded_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"leader_id" varchar(32) NOT NULL,
	"status" "team_status" DEFAULT 'DRAFT' NOT NULL,
	"locked_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(32) NOT NULL,
	"purchase_item_id" uuid,
	"registration_id" uuid,
	"beneficiary_id" varchar(32) NOT NULL,
	"item_type" "item_type" NOT NULL,
	"event_id" uuid,
	"tier" "ticket_tier" DEFAULT 'GENERAL' NOT NULL,
	"status" "ticket_status" DEFAULT 'ACTIVE' NOT NULL,
	"qr_version" integer DEFAULT 1 NOT NULL,
	"valid_from" bigint,
	"valid_to" bigint,
	"event_checked_in_at" bigint,
	"revoked_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "tickets_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "tickets_registration_id_unique" UNIQUE("registration_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"google_sub" text,
	"email" text NOT NULL,
	"password_hash" text,
	"name" text NOT NULL,
	"avatar_url" text,
	"phone" varchar(20),
	"is_student" smallint DEFAULT 0 NOT NULL,
	"institution_name" text,
	"institution_id" text,
	"student_fields_locked" smallint DEFAULT 0 NOT NULL,
	"role" "user_role" DEFAULT 'PARTICIPANT' NOT NULL,
	"can_review_payments" smallint DEFAULT 0 NOT NULL,
	"is_active" smallint DEFAULT 1 NOT NULL,
	"email_verified_at" bigint,
	"profile_completed_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_logs" ADD CONSTRAINT "check_in_logs_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_logs" ADD CONSTRAINT "check_in_logs_scanned_by_users_id_fk" FOREIGN KEY ("scanned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_logs" ADD CONSTRAINT "check_in_logs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esports_matches" ADD CONSTRAINT "esports_matches_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esports_matches" ADD CONSTRAINT "esports_matches_participant_a_id_registrations_id_fk" FOREIGN KEY ("participant_a_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esports_matches" ADD CONSTRAINT "esports_matches_participant_b_id_registrations_id_fk" FOREIGN KEY ("participant_b_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esports_matches" ADD CONSTRAINT "esports_matches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esports_score_history" ADD CONSTRAINT "esports_score_history_score_id_esports_scores_id_fk" FOREIGN KEY ("score_id") REFERENCES "public"."esports_scores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esports_score_history" ADD CONSTRAINT "esports_score_history_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esports_score_history" ADD CONSTRAINT "esports_score_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esports_scores" ADD CONSTRAINT "esports_scores_match_id_esports_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."esports_matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esports_scores" ADD CONSTRAINT "esports_scores_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esports_scores" ADD CONSTRAINT "esports_scores_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esports_scores" ADD CONSTRAINT "esports_scores_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_form_versions" ADD CONSTRAINT "event_form_versions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_form_versions" ADD CONSTRAINT "event_form_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_staff" ADD CONSTRAINT "event_staff_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_staff" ADD CONSTRAINT "event_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_staff" ADD CONSTRAINT "event_staff_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_fest_day_fest_days_day_number_fk" FOREIGN KEY ("fest_day") REFERENCES "public"."fest_days"("day_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_staff" ADD CONSTRAINT "gate_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_staff" ADD CONSTRAINT "gate_staff_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_beneficiary_id_users_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_participant_id_users_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_purchase_item_id_purchase_items_id_fk" FOREIGN KEY ("purchase_item_id") REFERENCES "public"."purchase_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_form_version_id_event_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."event_form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_leader_id_users_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_purchase_item_id_purchase_items_id_fk" FOREIGN KEY ("purchase_item_id") REFERENCES "public"."purchase_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_beneficiary_id_users_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_check_in_logs_admitted_unique" ON "check_in_logs" USING btree ("ticket_id","event_id") WHERE "check_in_logs"."verdict" = 'ADMITTED' AND "check_in_logs"."context" = 'EVENT';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_esports_matches_event_round_match" ON "esports_matches" USING btree ("event_id","round_number","match_number");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_esports_scores_round_unique" ON "esports_scores" USING btree ("event_id","registration_id","round_no");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_event_form_versions_event_version" ON "event_form_versions" USING btree ("event_id","version");--> statement-breakpoint
CREATE INDEX "idx_events_status_category" ON "events" USING btree ("status","category");--> statement-breakpoint
CREATE INDEX "idx_events_fest_day" ON "events" USING btree ("fest_day");--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_expires_at" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payments_active_utr_unique" ON "payments" USING btree ("transaction_id") WHERE "payments"."status" IN ('SUBMITTED', 'PENDING', 'ON_HOLD', 'APPROVED', 'SUCCESS');--> statement-breakpoint
CREATE INDEX "idx_purchases_buyer_id" ON "purchases" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_status" ON "purchases" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_registrations_event_participant_unique" ON "registrations" USING btree ("event_id","participant_id") WHERE "registrations"."status" IN ('RESERVED', 'CONFIRMED');--> statement-breakpoint
CREATE INDEX "idx_sessions_user_id" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires_at" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_team_members_team_user_unique" ON "team_members" USING btree ("team_id","user_id") WHERE "team_members"."user_id" IS NOT NULL AND "team_members"."status" IN ('INVITED', 'ACCEPTED');--> statement-breakpoint
CREATE UNIQUE INDEX "idx_team_members_team_email_unique" ON "team_members" USING btree ("team_id",lower("invited_email")) WHERE "team_members"."status" IN ('INVITED', 'ACCEPTED');--> statement-breakpoint
CREATE UNIQUE INDEX "idx_teams_event_name_unique" ON "teams" USING btree ("event_id",lower("name")) WHERE "teams"."status" != 'CANCELLED';--> statement-breakpoint
CREATE INDEX "idx_tickets_beneficiary_id" ON "tickets" USING btree ("beneficiary_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_event_id" ON "tickets" USING btree ("event_id");