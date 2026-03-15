ALTER TABLE `authelia_users` ADD `external_email` text;--> statement-breakpoint
ALTER TABLE `authelia_users` ADD `auth_policy` text DEFAULT 'two_factor' NOT NULL;