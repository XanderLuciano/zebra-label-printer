-- Fix timestamp defaults, and repair the timestamps they corrupted.
--
-- Every `created_at`/`updated_at` column was declared as
--   DEFAULT '(datetime(''now''))'
-- which is a quoted string *literal*, not an expression. Rows inserted without an
-- explicit value therefore stored the seven-character-plus text
-- "(datetime('now'))" instead of a timestamp, so print history dates, history
-- ordering, and the template list's "most recently edited first" sort were all
-- built on a non-date. This migration corrects the DDL to
--   DEFAULT (datetime('now'))
-- and then repairs the existing rows.
--
-- ── Why this is not drizzle-kit's generated migration ────────────────────────
--
-- The generated version rebuilds `job_logs` first, keeping its
-- `REFERENCES print_jobs(id) ON DELETE CASCADE`, and later runs
-- `DROP TABLE print_jobs`. With `foreign_keys=ON` — which this app sets in
-- database.ts — dropping a parent table performs an implicit cascading delete,
-- silently emptying `job_logs`. The `PRAGMA foreign_keys=OFF` it emits does not
-- help: SQLite ignores that pragma inside a transaction, and the migrator runs in
-- one.
--
-- So the foreign key is removed before `print_jobs` is rebuilt and restored
-- afterwards, which is safe whatever the pragma happens to be set to.

-- ── 1. Rebuild job_logs without its foreign key ──────────────────────────────
-- Leaves print_jobs childless so the next step cannot cascade.
CREATE TABLE `__fix_job_logs_nofk` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`message` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__fix_job_logs_nofk`("id", "job_id", "level", "message", "created_at") SELECT "id", "job_id", "level", "message", "created_at" FROM `job_logs`;--> statement-breakpoint
DROP TABLE `job_logs`;--> statement-breakpoint
ALTER TABLE `__fix_job_logs_nofk` RENAME TO `job_logs`;--> statement-breakpoint

-- ── 2. Rebuild print_jobs ────────────────────────────────────────────────────
CREATE TABLE `__new_print_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`job_type` text NOT NULL,
	`request_data` text NOT NULL,
	`zpl_commands` text,
	`printer_name` text,
	`printer_id` text,
	`cups_job_id` text,
	`error_message` text,
	`label_width_dots` integer,
	`label_height_dots` integer,
	`label_dpi` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`started_at` text,
	`completed_at` text,
	`priority` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_print_jobs`("id", "status", "job_type", "request_data", "zpl_commands", "printer_name", "printer_id", "cups_job_id", "error_message", "label_width_dots", "label_height_dots", "label_dpi", "created_at", "started_at", "completed_at", "priority") SELECT "id", "status", "job_type", "request_data", "zpl_commands", "printer_name", "printer_id", "cups_job_id", "error_message", "label_width_dots", "label_height_dots", "label_dpi", "created_at", "started_at", "completed_at", "priority" FROM `print_jobs`;--> statement-breakpoint
DROP TABLE `print_jobs`;--> statement-breakpoint
ALTER TABLE `__new_print_jobs` RENAME TO `print_jobs`;--> statement-breakpoint
CREATE INDEX `idx_print_jobs_status` ON `print_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_print_jobs_created` ON `print_jobs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_print_jobs_printer` ON `print_jobs` (`printer_id`);--> statement-breakpoint

-- ── 3. Restore the job_logs foreign key ──────────────────────────────────────
-- Orphans are filtered out rather than allowed to abort the migration; the
-- cascade means there should not be any.
CREATE TABLE `__new_job_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`message` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `print_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_job_logs`("id", "job_id", "level", "message", "created_at") SELECT "id", "job_id", "level", "message", "created_at" FROM `job_logs` WHERE "job_id" IN (SELECT "id" FROM `print_jobs`);--> statement-breakpoint
DROP TABLE `job_logs`;--> statement-breakpoint
ALTER TABLE `__new_job_logs` RENAME TO `job_logs`;--> statement-breakpoint
CREATE INDEX `idx_job_logs_job` ON `job_logs` (`job_id`);--> statement-breakpoint

-- ── 4. Rebuild the tables with no foreign keys ───────────────────────────────
CREATE TABLE `__new_label_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`data` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_label_templates`("id", "name", "description", "data", "created_at", "updated_at") SELECT "id", "name", "description", "data", "created_at", "updated_at" FROM `label_templates`;--> statement-breakpoint
DROP TABLE `label_templates`;--> statement-breakpoint
ALTER TABLE `__new_label_templates` RENAME TO `label_templates`;--> statement-breakpoint
CREATE INDEX `idx_label_templates_name` ON `label_templates` (`name`);--> statement-breakpoint
CREATE TABLE `__new_printer_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`printer_name` text NOT NULL,
	`event_type` text NOT NULL,
	`message` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_printer_events`("id", "printer_name", "event_type", "message", "created_at") SELECT "id", "printer_name", "event_type", "message", "created_at" FROM `printer_events`;--> statement-breakpoint
DROP TABLE `printer_events`;--> statement-breakpoint
ALTER TABLE `__new_printer_events` RENAME TO `printer_events`;--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_settings`("key", "value", "updated_at") SELECT "key", "value", "updated_at" FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint

-- ── 5. Repair the corrupted timestamps ───────────────────────────────────────
--
-- A print job's id embeds its creation time: `job_${Date.now()}_${random}`. That
-- makes print_jobs recoverable exactly, which is the table that matters — it's
-- what print history is built from.
UPDATE `print_jobs`
SET `created_at` = datetime(CAST(substr(`id`, 5, 13) AS INTEGER) / 1000, 'unixepoch')
WHERE `created_at` = '(datetime(''now''))'
  AND substr(`id`, 1, 4) = 'job_'
  AND substr(`id`, 5, 13) GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]';--> statement-breakpoint

-- Jobs whose id predates that format: fall back to when they started or finished
-- printing. Those columns were always written explicitly, so they are real.
UPDATE `print_jobs`
SET `created_at` = COALESCE(`started_at`, `completed_at`)
WHERE `created_at` = '(datetime(''now''))'
  AND COALESCE(`started_at`, `completed_at`) IS NOT NULL;--> statement-breakpoint

-- A log entry has no recoverable time of its own, but it belongs to a job that
-- now does. Ordering within a job still comes from the autoincrementing id.
UPDATE `job_logs`
SET `created_at` = (SELECT `created_at` FROM `print_jobs` WHERE `print_jobs`.`id` = `job_logs`.`job_id`)
WHERE `created_at` = '(datetime(''now''))'
  AND (SELECT `created_at` FROM `print_jobs` WHERE `print_jobs`.`id` = `job_logs`.`job_id`) NOT IN ('(datetime(''now''))');--> statement-breakpoint

-- Anything still unrecovered gets the epoch rather than a plausible-looking
-- invention. It reads as "unknown", sorts oldest, and is a valid datetime, so
-- display and ordering work instead of choking on a non-date. Templates the user
-- has actually edited already carry a real updated_at written by updateTemplate().
UPDATE `print_jobs` SET `created_at` = '1970-01-01 00:00:00' WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `job_logs` SET `created_at` = '1970-01-01 00:00:00' WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `printer_events` SET `created_at` = '1970-01-01 00:00:00' WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `label_templates` SET `created_at` = '1970-01-01 00:00:00' WHERE `created_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `label_templates` SET `updated_at` = '1970-01-01 00:00:00' WHERE `updated_at` = '(datetime(''now''))';--> statement-breakpoint
UPDATE `settings` SET `updated_at` = '1970-01-01 00:00:00' WHERE `updated_at` = '(datetime(''now''))';
