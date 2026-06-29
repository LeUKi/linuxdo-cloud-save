CREATE TABLE `public_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_id` text NOT NULL,
	`slot_id` text NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_slots_app_slot_unique` ON `public_slots` (`app_id`,`slot_id`);--> statement-breakpoint
CREATE INDEX `public_slots_app_idx` ON `public_slots` (`app_id`);