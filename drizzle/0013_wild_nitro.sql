ALTER TABLE "board_feed_items" ADD COLUMN "sentiment_score" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "board_feed_items" ADD COLUMN "controversy_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "board_feed_items" ADD COLUMN "entity_keys_json" jsonb;