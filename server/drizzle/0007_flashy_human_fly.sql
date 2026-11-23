CREATE TABLE "meal_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"slot" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"kcal" integer NOT NULL,
	"protein_g" integer NOT NULL,
	"ingredients" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "meal_plans_day_slot_idx" ON "meal_plans" USING btree ("day","slot");