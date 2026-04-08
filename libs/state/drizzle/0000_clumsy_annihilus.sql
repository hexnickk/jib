CREATE TABLE `jib_migrations` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text DEFAULT (datetime('now')) NOT NULL
);
