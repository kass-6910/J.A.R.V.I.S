CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spent_on" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"label" text NOT NULL,
	"merchant" text,
	"category" text NOT NULL,
	"space" text DEFAULT 'vie-perso' NOT NULL,
	"source" text NOT NULL,
	"receipt_file" text,
	"subscription_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"day_of_month" integer NOT NULL,
	"category" text DEFAULT 'abonnements' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "expenses_spent_on_idx" ON "expenses" USING btree ("spent_on");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_subscription_month_idx" ON "expenses" USING btree ("subscription_id","spent_on") WHERE subscription_id is not null;