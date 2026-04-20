CREATE TABLE `publish_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`slug` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`dry_run` integer DEFAULT false NOT NULL,
	`payload` text NOT NULL,
	`errors` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `publish_runs_idempotency_key_unique` ON `publish_runs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `publish_runs_slug_idx` ON `publish_runs` (`slug`);--> statement-breakpoint
CREATE TABLE `publish_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`started_at` text,
	`finished_at` text,
	`detail` text,
	`error` text,
	`before` text,
	`after` text,
	`requires_approval` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `publish_runs`(`id`) ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX `publish_steps_run_idx` ON `publish_steps` (`run_id`);--> statement-breakpoint
CREATE TABLE `publish_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`version` text NOT NULL,
	`action` text DEFAULT 'release' NOT NULL,
	`source` text DEFAULT 'admin' NOT NULL,
	`changelog` text DEFAULT '' NOT NULL,
	`set_as_current` integer DEFAULT true NOT NULL,
	`strapi_document_id` text,
	`strapi_status` text DEFAULT 'skipped',
	`run_id` text,
	`released_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `publish_runs`(`id`) ON DELETE set null ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX `publish_releases_slug_idx` ON `publish_releases` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `publish_releases_slug_version_idx` ON `publish_releases` (`slug`, `version`);--> statement-breakpoint
CREATE TABLE `publish_artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`release_id` text NOT NULL,
	`filename` text NOT NULL,
	`label` text,
	`platform` text,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`checksum_sha256` text,
	`storage_kind` text DEFAULT 'downloads' NOT NULL,
	`storage_path` text NOT NULL,
	`download_url` text NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`content_type` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `publish_releases`(`id`) ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX `publish_artifacts_release_idx` ON `publish_artifacts` (`release_id`);--> statement-breakpoint
CREATE TABLE `publish_uploads` (
	`handle` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`filename` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`received_bytes` integer DEFAULT 0 NOT NULL,
	`content_type` text,
	`checksum_sha256` text,
	`storage_kind` text DEFAULT 'downloads' NOT NULL,
	`storage_visibility` text DEFAULT 'public' NOT NULL,
	`storage_base_path` text,
	`version` text,
	`temp_path` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` text NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL
);
