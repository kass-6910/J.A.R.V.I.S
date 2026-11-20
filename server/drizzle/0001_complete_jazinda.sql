CREATE TABLE "briefings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"remind_at" timestamp with time zone NOT NULL,
	"level" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "deadline_alerted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "briefings_day_kind_idx" ON "briefings" USING btree ("day","kind");--> statement-breakpoint
CREATE INDEX "reminders_due_idx" ON "reminders" USING btree ("status","remind_at");