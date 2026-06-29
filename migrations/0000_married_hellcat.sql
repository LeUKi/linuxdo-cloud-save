CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_verifier` text,
	`pkce_enabled` integer DEFAULT true NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_states_expires_at_idx` ON `oauth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `save_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`app_id` text NOT NULL,
	`slot_id` text NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `save_slots_user_app_slot_unique` ON `save_slots` (`user_id`,`app_id`,`slot_id`);--> statement-breakpoint
CREATE INDEX `save_slots_user_app_idx` ON `save_slots` (`user_id`,`app_id`);--> statement-breakpoint
CREATE TABLE `service_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`app_id` text NOT NULL,
	`token_strategy` text NOT NULL,
	`token_hash` text,
	`encrypted_token` text,
	`jwt_id` text,
	`revoked_at` text,
	`last_used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `service_tokens_user_app_idx` ON `service_tokens` (`user_id`,`app_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `service_tokens_active_opaque_user_app_unique` ON `service_tokens` (`user_id`,`app_id`) WHERE revoked_at IS NULL AND token_strategy = 'opaque_reuse';--> statement-breakpoint
CREATE UNIQUE INDEX `service_tokens_token_hash_unique` ON `service_tokens` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `service_tokens_jwt_id_unique` ON `service_tokens` (`jwt_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`linux_do_id` text NOT NULL,
	`username` text,
	`name` text,
	`avatar_url` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_linux_do_id_unique` ON `users` (`linux_do_id`);
