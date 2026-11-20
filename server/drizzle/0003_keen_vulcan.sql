CREATE TABLE "daily_hadith" (
	"day" date PRIMARY KEY NOT NULL,
	"edition" text NOT NULL,
	"collection" text NOT NULL,
	"number" text NOT NULL,
	"text" text NOT NULL,
	"grade" text
);
--> statement-breakpoint
CREATE TABLE "prayer_times" (
	"day" date PRIMARY KEY NOT NULL,
	"timings" jsonb NOT NULL,
	"method" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_blocks_prayer_idx" ON "schedule_blocks" USING btree ("day","title") WHERE kind = 'prayer';