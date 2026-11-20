CREATE TABLE "kv_store" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mail_id" uuid NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"thread_id" text,
	"message_id_header" text,
	"from_name" text NOT NULL,
	"from_address" text NOT NULL,
	"reply_address" text NOT NULL,
	"subject" text NOT NULL,
	"snippet" text NOT NULL,
	"body" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"unread" boolean NOT NULL,
	"importance" text,
	"summary" text,
	"needs_reply" boolean DEFAULT false NOT NULL,
	"school_event" jsonb,
	"triage_source" text,
	"triage_attempts" integer DEFAULT 0 NOT NULL,
	"notified_at" timestamp with time zone,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_drafts" ADD CONSTRAINT "mail_drafts_mail_id_mails_id_fk" FOREIGN KEY ("mail_id") REFERENCES "public"."mails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mails_provider_external_idx" ON "mails" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "mails_received_idx" ON "mails" USING btree ("received_at");