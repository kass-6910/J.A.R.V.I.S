CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"subject" text,
	"file_name" text NOT NULL,
	"summary" text NOT NULL,
	"sheet" text NOT NULL,
	"quiz" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"day" date NOT NULL,
	"time" text,
	"source" text NOT NULL,
	"revision_task_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "not_before" date;--> statement-breakpoint
CREATE UNIQUE INDEX "exams_title_day_idx" ON "exams" USING btree (lower("title"),"day");