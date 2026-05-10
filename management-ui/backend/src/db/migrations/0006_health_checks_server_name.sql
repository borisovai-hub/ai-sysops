ALTER TABLE `health_checks` ADD `server_name` text DEFAULT 'local' NOT NULL;
CREATE INDEX IF NOT EXISTS `idx_health_checks_server_service_time` ON `health_checks` (`server_name`, `service_name`, `checked_at`);
