ALTER TABLE `label_templates` ADD `short_name` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_label_templates_short_name` ON `label_templates` (`short_name`);