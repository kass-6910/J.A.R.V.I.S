CREATE TABLE "health_days" (
	"day" date PRIMARY KEY NOT NULL,
	"steps" integer,
	"active_kcal" integer,
	"sleep_min" integer,
	"sleep_start" timestamp with time zone,
	"sleep_end" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"kcal" integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workouts_start_type_idx" ON "workouts" USING btree ("starts_at","type");