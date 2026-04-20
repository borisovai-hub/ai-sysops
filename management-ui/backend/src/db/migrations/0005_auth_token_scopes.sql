ALTER TABLE `auth_tokens` ADD `scopes` text DEFAULT '["*"]' NOT NULL;
