CREATE TABLE `agent_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`tool_args` text NOT NULL,
	`tier` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`resolved_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_name` text,
	`tool_call_id` text,
	`tool_args` text,
	`tool_tier` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`model` text DEFAULT 'claude-sonnet-4-20250514' NOT NULL,
	`system_prompt` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`entity` text,
	`entity_id` text,
	`user` text,
	`auth_method` text,
	`details` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_tokens_name_unique` ON `auth_tokens` (`name`);--> statement-breakpoint
CREATE TABLE `authelia_users` (
	`username` text PRIMARY KEY NOT NULL,
	`displayname` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`password_hash` text NOT NULL,
	`groups` text DEFAULT '[]' NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`mailbox` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `config_entries` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`source` text DEFAULT 'config' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dns_records` (
	`id` text PRIMARY KEY NOT NULL,
	`subdomain` text NOT NULL,
	`domain` text NOT NULL,
	`type` text DEFAULT 'A' NOT NULL,
	`ip` text NOT NULL,
	`created_at` text
);
--> statement-breakpoint
CREATE TABLE `project_releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`version` text NOT NULL,
	`download_url` text DEFAULT '' NOT NULL,
	`changelog` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'unknown' NOT NULL,
	`action` text DEFAULT 'release' NOT NULL,
	`strapi_updated` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`step_name` text NOT NULL,
	`done` integer NOT NULL,
	`detail` text,
	`error` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`gitlab_project_id` integer NOT NULL,
	`project_type` text NOT NULL,
	`app_type` text DEFAULT 'frontend' NOT NULL,
	`domain` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`authelia` integer DEFAULT true NOT NULL,
	`path_with_namespace` text,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`port_frontend` integer,
	`port_backend` integer,
	`status` text DEFAULT 'partial' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE TABLE `ru_proxy_domains` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain` text NOT NULL,
	`backend` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ru_proxy_domains_domain_unique` ON `ru_proxy_domains` (`domain`);--> statement-breakpoint
CREATE TABLE `services` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`internal_ip` text DEFAULT '127.0.0.1' NOT NULL,
	`port` integer NOT NULL,
	`config_file` text NOT NULL,
	`router_name` text,
	`has_authelia` integer DEFAULT false NOT NULL,
	`is_system_service` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `services_name_unique` ON `services` (`name`);