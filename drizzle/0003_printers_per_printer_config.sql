CREATE TABLE `printers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`transport` text DEFAULT 'cups' NOT NULL,
	`cups_name` text,
	`device_uri` text,
	`usb_device_id` text,
	`label_width_dots` integer DEFAULT 609 NOT NULL,
	`label_height_dots` integer DEFAULT 1015 NOT NULL,
	`label_name` text,
	`dpi` integer DEFAULT 203 NOT NULL,
	`tracking` text DEFAULT 'gap' NOT NULL,
	`mark_offset` integer,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_printers_cups_name` ON `printers` (`cups_name`);--> statement-breakpoint
CREATE INDEX `idx_printers_default` ON `printers` (`is_default`);--> statement-breakpoint
ALTER TABLE `print_jobs` ADD `printer_id` text;--> statement-breakpoint
CREATE INDEX `idx_print_jobs_printer` ON `print_jobs` (`printer_id`);