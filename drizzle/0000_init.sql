CREATE TABLE `records` (
	`collection` text NOT NULL,
	`id` text NOT NULL,
	`ym` text DEFAULT '' NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`collection`, `id`)
);
--> statement-breakpoint
CREATE INDEX `records_collection_ym_idx` ON `records` (`collection`,`ym`);