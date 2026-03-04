CREATE TABLE `alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`severity` text NOT NULL,
	`category` text NOT NULL,
	`source` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`acknowledged_by` text,
	`resolved_at` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `health_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service_name` text NOT NULL,
	`status` text NOT NULL,
	`response_time_ms` integer,
	`status_code` integer,
	`error` text,
	`details` text,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_type` text NOT NULL,
	`severity` text NOT NULL,
	`source_ip` text,
	`username` text,
	`service_name` text,
	`description` text NOT NULL,
	`details` text,
	`resolved` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
