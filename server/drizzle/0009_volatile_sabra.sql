CREATE TABLE "outfits" (
	"day" date PRIMARY KEY NOT NULL,
	"item_ids" jsonb NOT NULL,
	"sport_bag_id" uuid,
	"reason" text NOT NULL,
	"weather" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wardrobe_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"photo_file" text NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"color" text NOT NULL,
	"style" text NOT NULL,
	"warmth" text NOT NULL,
	"rain_proof" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
