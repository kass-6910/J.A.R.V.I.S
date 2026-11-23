CREATE TABLE "admin_deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"due_on" date NOT NULL,
	"remind_days" integer DEFAULT 7 NOT NULL,
	"notes" text,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "care_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"every_days" integer NOT NULL,
	"duration_min" integer DEFAULT 45 NOT NULL,
	"last_done_on" date,
	"pending_task_id" uuid,
	"pending_shopping_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"relation" text,
	"birthday" text,
	"birth_year" integer,
	"call_every_days" integer,
	"last_contact_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routines" (
	"moment" text PRIMARY KEY NOT NULL,
	"time" text NOT NULL,
	"items" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"qty" text,
	"source" text NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplement_intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplement_id" uuid NOT NULL,
	"day" date NOT NULL,
	"reminded_at" timestamp with time zone,
	"nudged_at" timestamp with time zone,
	"taken_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "supplements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"moment" text NOT NULL,
	"with_meal" boolean DEFAULT true NOT NULL,
	"stock_doses" integer,
	"low_at" integer DEFAULT 7 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplement_intakes" ADD CONSTRAINT "supplement_intakes_supplement_id_supplements_id_fk" FOREIGN KEY ("supplement_id") REFERENCES "public"."supplements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplement_intakes_day_idx" ON "supplement_intakes" USING btree ("supplement_id","day");