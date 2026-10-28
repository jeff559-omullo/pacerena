CREATE TABLE `platform_settings` (
	`id` int NOT NULL,
	`challengeCreationEnabled` int NOT NULL DEFAULT 1,
	`minimumStake` int NOT NULL DEFAULT 10,
	`maximumStake` int NOT NULL DEFAULT 5000,
	`defaultMatchMinutes` int NOT NULL DEFAULT 12,
	`maintenanceNotice` varchar(400),
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `platform_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `platform_settings_singleton` CHECK(`platform_settings`.`id` = 1),
	CONSTRAINT `platform_settings_creation_flag` CHECK(`platform_settings`.`challengeCreationEnabled` IN (0, 1)),
	CONSTRAINT `platform_settings_min_stake_range` CHECK(`platform_settings`.`minimumStake` >= 10 AND `platform_settings`.`minimumStake` <= 5000),
	CONSTRAINT `platform_settings_max_stake_range` CHECK(`platform_settings`.`maximumStake` >= 10 AND `platform_settings`.`maximumStake` <= 5000),
	CONSTRAINT `platform_settings_stake_order` CHECK(`platform_settings`.`minimumStake` <= `platform_settings`.`maximumStake`),
	CONSTRAINT `platform_settings_match_duration` CHECK(`platform_settings`.`defaultMatchMinutes` >= 6 AND `platform_settings`.`defaultMatchMinutes` <= 30)
);
--> statement-breakpoint
ALTER TABLE `platform_settings` ADD CONSTRAINT `platform_settings_updatedBy_users_id_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO `platform_settings` (`id`, `challengeCreationEnabled`, `minimumStake`, `maximumStake`, `defaultMatchMinutes`, `maintenanceNotice`, `updatedBy`) VALUES (1, 1, 10, 5000, 12, NULL, NULL);
