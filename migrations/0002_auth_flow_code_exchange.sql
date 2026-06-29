DROP TABLE `oauth_states`;
--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`flow_id` text NOT NULL,
	`exchange_challenge` text NOT NULL,
	`code_verifier` text,
	`pkce_enabled` integer DEFAULT true NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_states_expires_at_idx` ON `oauth_states` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `auth_exchange_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`flow_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`exchange_challenge` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_exchange_codes_expires_at_idx` ON `auth_exchange_codes` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `auth_exchange_codes_user_app_idx` ON `auth_exchange_codes` (`user_id`,`app_id`);
