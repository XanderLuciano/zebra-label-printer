CREATE TABLE `job_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`message` text NOT NULL,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `print_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_job_logs_job` ON `job_logs` (`job_id`);--> statement-breakpoint
CREATE TABLE `print_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`job_type` text NOT NULL,
	`request_data` text NOT NULL,
	`zpl_commands` text,
	`printer_name` text,
	`cups_job_id` text,
	`error_message` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL,
	`started_at` text,
	`completed_at` text,
	`priority` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_print_jobs_status` ON `print_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_print_jobs_created` ON `print_jobs` (`created_at`);--> statement-breakpoint
CREATE TABLE `printer_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`printer_name` text NOT NULL,
	`event_type` text NOT NULL,
	`message` text,
	`created_at` text DEFAULT '(datetime(''now''))' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))' NOT NULL
);
