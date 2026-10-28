CREATE TABLE `dispute_attachments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`disputeId` int NOT NULL,
	`userId` int NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`mimeType` enum('image/jpeg','image/png','image/webp') NOT NULL,
	`sizeBytes` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dispute_attachments_id` PRIMARY KEY(`id`),
	CONSTRAINT `dispute_attachment_file_size` CHECK(`dispute_attachments`.`sizeBytes` >= 64 AND `dispute_attachments`.`sizeBytes` <= 5242880)
);
--> statement-breakpoint
CREATE TABLE `match_state_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matchId` int NOT NULL,
	`fromState` enum('DRAFT','OPEN','ACCEPTED','AWAITING_STAKES','READY','IN_PROGRESS','AWAITING_EVIDENCE','UNDER_REVIEW','COMPLETED','DRAWN','CANCELLED','REFUNDED') NOT NULL,
	`toState` enum('DRAFT','OPEN','ACCEPTED','AWAITING_STAKES','READY','IN_PROGRESS','AWAITING_EVIDENCE','UNDER_REVIEW','COMPLETED','DRAWN','CANCELLED','REFUNDED') NOT NULL,
	`actorUserId` int,
	`reason` varchar(1000) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `match_state_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `dispute_attachments` ADD CONSTRAINT `dispute_attachments_disputeId_disputes_id_fk` FOREIGN KEY (`disputeId`) REFERENCES `disputes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dispute_attachments` ADD CONSTRAINT `dispute_attachments_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `match_state_events` ADD CONSTRAINT `match_state_events_matchId_matches_id_fk` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `match_state_events` ADD CONSTRAINT `match_state_events_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `dispute_attachment_idx` ON `dispute_attachments` (`disputeId`);--> statement-breakpoint
CREATE INDEX `match_state_event_idx` ON `match_state_events` (`matchId`,`createdAt`);--> statement-breakpoint
ALTER TABLE `challenges` ADD CONSTRAINT `challenge_stake_range` CHECK (`challenges`.`stake` >= 10 AND `challenges`.`stake` <= 5000);--> statement-breakpoint
ALTER TABLE `challenges` ADD CONSTRAINT `challenge_duration_range` CHECK (`challenges`.`matchMinutes` >= 6 AND `challenges`.`matchMinutes` <= 30);--> statement-breakpoint
ALTER TABLE `match_evidence` ADD CONSTRAINT `match_evidence_file_size` CHECK (`match_evidence`.`sizeBytes` >= 64 AND `match_evidence`.`sizeBytes` <= 5242880);--> statement-breakpoint
ALTER TABLE `match_evidence` ADD CONSTRAINT `match_evidence_score_for_valid` CHECK (`match_evidence`.`scoreFor` >= 0 AND `match_evidence`.`scoreFor` <= 99);--> statement-breakpoint
ALTER TABLE `match_evidence` ADD CONSTRAINT `match_evidence_score_against_valid` CHECK (`match_evidence`.`scoreAgainst` >= 0 AND `match_evidence`.`scoreAgainst` <= 99);--> statement-breakpoint
ALTER TABLE `match_participants` ADD CONSTRAINT `participant_stake_positive` CHECK (`match_participants`.`stake` > 0);--> statement-breakpoint
ALTER TABLE `match_participants` ADD CONSTRAINT `participant_score_for_valid` CHECK (`match_participants`.`scoreFor` IS NULL OR (`match_participants`.`scoreFor` >= 0 AND `match_participants`.`scoreFor` <= 99));--> statement-breakpoint
ALTER TABLE `match_participants` ADD CONSTRAINT `participant_score_against_valid` CHECK (`match_participants`.`scoreAgainst` IS NULL OR (`match_participants`.`scoreAgainst` >= 0 AND `match_participants`.`scoreAgainst` <= 99));--> statement-breakpoint
ALTER TABLE `wallet_accounts` ADD CONSTRAINT `wallet_available_nonnegative` CHECK (`wallet_accounts`.`availableCredits` >= 0);--> statement-breakpoint
ALTER TABLE `wallet_accounts` ADD CONSTRAINT `wallet_reserved_nonnegative` CHECK (`wallet_accounts`.`reservedCredits` >= 0);--> statement-breakpoint
ALTER TABLE `wallet_transactions` ADD CONSTRAINT `wallet_tx_amount_nonnegative` CHECK (`wallet_transactions`.`amount` >= 0);--> statement-breakpoint
ALTER TABLE `wallet_transactions` ADD CONSTRAINT `wallet_tx_available_before_nonnegative` CHECK (`wallet_transactions`.`availableBefore` >= 0);--> statement-breakpoint
ALTER TABLE `wallet_transactions` ADD CONSTRAINT `wallet_tx_available_after_nonnegative` CHECK (`wallet_transactions`.`availableAfter` >= 0);--> statement-breakpoint
ALTER TABLE `wallet_transactions` ADD CONSTRAINT `wallet_tx_reserved_before_nonnegative` CHECK (`wallet_transactions`.`reservedBefore` >= 0);--> statement-breakpoint
ALTER TABLE `wallet_transactions` ADD CONSTRAINT `wallet_tx_reserved_after_nonnegative` CHECK (`wallet_transactions`.`reservedAfter` >= 0);