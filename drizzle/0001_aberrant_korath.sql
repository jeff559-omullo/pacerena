CREATE TABLE `admin_audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adminUserId` int NOT NULL,
	`action` varchar(80) NOT NULL,
	`entityType` varchar(48) NOT NULL,
	`entityId` int NOT NULL,
	`reason` varchar(2000) NOT NULL,
	`details` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`lastUsedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auth_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_sessions_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `challenges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`creatorId` int NOT NULL,
	`opponentId` int,
	`game` enum('efootball','ea_fc') NOT NULL,
	`edition` varchar(48) NOT NULL,
	`platform` enum('android','ios','pc','ps4','ps5','xbox_one','xbox_series','switch') NOT NULL,
	`stake` int NOT NULL,
	`matchMinutes` int NOT NULL DEFAULT 12,
	`settings` text,
	`description` varchar(500),
	`status` enum('open','accepted','expired','cancelled') NOT NULL DEFAULT 'open',
	`expiresAt` timestamp NOT NULL,
	`acceptedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `challenges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `disputes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matchId` int NOT NULL,
	`openedBy` int NOT NULL,
	`reason` enum('conflicting_scores','missing_evidence','incorrect_screenshot','disconnect','wrong_settings','suspected_cheating','other') NOT NULL,
	`explanation` varchar(3000) NOT NULL,
	`status` enum('OPEN','INVESTIGATING','RESOLVED','REJECTED') NOT NULL DEFAULT 'OPEN',
	`administrativeNotes` text,
	`resolutionReason` varchar(2000),
	`resolvedBy` int,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `disputes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_accounts` (
	`userId` int NOT NULL,
	`emailNormalized` varchar(320) NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`emailVerifiedAt` timestamp,
	`verifyTokenHash` varchar(64),
	`verifyExpiresAt` timestamp,
	`resetTokenHash` varchar(64),
	`resetExpiresAt` timestamp,
	`failedLoginCount` int NOT NULL DEFAULT 0,
	`lockedUntil` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_accounts_userId` PRIMARY KEY(`userId`),
	CONSTRAINT `email_accounts_emailNormalized_unique` UNIQUE(`emailNormalized`)
);
--> statement-breakpoint
CREATE TABLE `match_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matchId` int NOT NULL,
	`userId` int NOT NULL,
	`code` varchar(160) NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `match_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `match_code_owner_unique` UNIQUE(`matchId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `match_evidence` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matchId` int NOT NULL,
	`userId` int NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`mimeType` enum('image/jpeg','image/png','image/webp') NOT NULL,
	`sizeBytes` int NOT NULL,
	`scoreFor` int NOT NULL,
	`scoreAgainst` int NOT NULL,
	`comments` varchar(1000),
	`submittedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `match_evidence_id` PRIMARY KEY(`id`),
	CONSTRAINT `match_evidence_submitter_unique` UNIQUE(`matchId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `match_participants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matchId` int NOT NULL,
	`userId` int NOT NULL,
	`side` enum('home','away') NOT NULL,
	`stake` int NOT NULL,
	`readyAt` timestamp,
	`scoreFor` int,
	`scoreAgainst` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `match_participants_id` PRIMARY KEY(`id`),
	CONSTRAINT `match_participant_unique` UNIQUE(`matchId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `matches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`challengeId` int NOT NULL,
	`status` enum('DRAFT','OPEN','ACCEPTED','AWAITING_STAKES','READY','IN_PROGRESS','AWAITING_EVIDENCE','UNDER_REVIEW','COMPLETED','DRAWN','CANCELLED','REFUNDED') NOT NULL DEFAULT 'AWAITING_STAKES',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`acceptedAt` timestamp NOT NULL,
	`stakesReservedAt` timestamp,
	`readyDeadline` timestamp,
	`startedAt` timestamp,
	`expectedEndAt` timestamp,
	`reportedEndAt` timestamp,
	`evidenceDeadline` timestamp,
	`settledAt` timestamp,
	`cancellationReason` varchar(500),
	`disputeReason` varchar(500),
	CONSTRAINT `matches_id` PRIMARY KEY(`id`),
	CONSTRAINT `matches_challenge_unique` UNIQUE(`challengeId`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` varchar(48) NOT NULL,
	`title` varchar(160) NOT NULL,
	`body` varchar(500) NOT NULL,
	`entityType` varchar(32),
	`entityId` int,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`userId` int NOT NULL,
	`username` varchar(24) NOT NULL,
	`avatarColor` varchar(16) NOT NULL DEFAULT '#B7F34A',
	`preferredGame` enum('efootball','ea_fc'),
	`gameEdition` varchar(48),
	`platform` enum('android','ios','pc','ps4','ps5','xbox_one','xbox_series','switch'),
	`country` varchar(2) NOT NULL DEFAULT 'KE',
	`generalLocation` varchar(80),
	`availability` enum('available','away') NOT NULL DEFAULT 'away',
	`eligibility` enum('eligible','review','suspended') NOT NULL DEFAULT 'eligible',
	`matchPreferences` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `profiles_userId` PRIMARY KEY(`userId`),
	CONSTRAINT `profiles_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
CREATE TABLE `wallet_accounts` (
	`userId` int NOT NULL,
	`availableCredits` int NOT NULL DEFAULT 0,
	`reservedCredits` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `wallet_accounts_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
CREATE TABLE `wallet_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`matchId` int,
	`transactionType` enum('initial_grant','stake_reservation','stake_release','winner_reward','draw_refund','cancellation_refund','stake_consumption','admin_adjustment') NOT NULL,
	`amount` int NOT NULL,
	`availableBefore` int NOT NULL,
	`availableAfter` int NOT NULL,
	`reservedBefore` int NOT NULL,
	`reservedAfter` int NOT NULL,
	`status` enum('completed','reserved','released') NOT NULL DEFAULT 'completed',
	`idempotencyKey` varchar(128) NOT NULL,
	`reason` varchar(1000),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wallet_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `wallet_tx_idempotency_unique` UNIQUE(`userId`,`idempotencyKey`)
);
--> statement-breakpoint
ALTER TABLE `admin_audit_logs` ADD CONSTRAINT `admin_audit_logs_adminUserId_users_id_fk` FOREIGN KEY (`adminUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `challenges` ADD CONSTRAINT `challenges_creatorId_users_id_fk` FOREIGN KEY (`creatorId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `challenges` ADD CONSTRAINT `challenges_opponentId_users_id_fk` FOREIGN KEY (`opponentId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `disputes` ADD CONSTRAINT `disputes_matchId_matches_id_fk` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `disputes` ADD CONSTRAINT `disputes_openedBy_users_id_fk` FOREIGN KEY (`openedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `disputes` ADD CONSTRAINT `disputes_resolvedBy_users_id_fk` FOREIGN KEY (`resolvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `email_accounts` ADD CONSTRAINT `email_accounts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `match_codes` ADD CONSTRAINT `match_codes_matchId_matches_id_fk` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `match_codes` ADD CONSTRAINT `match_codes_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `match_evidence` ADD CONSTRAINT `match_evidence_matchId_matches_id_fk` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `match_evidence` ADD CONSTRAINT `match_evidence_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `match_participants` ADD CONSTRAINT `match_participants_matchId_matches_id_fk` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `match_participants` ADD CONSTRAINT `match_participants_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `matches` ADD CONSTRAINT `matches_challengeId_challenges_id_fk` FOREIGN KEY (`challengeId`) REFERENCES `challenges`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `profiles` ADD CONSTRAINT `profiles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wallet_accounts` ADD CONSTRAINT `wallet_accounts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wallet_transactions` ADD CONSTRAINT `wallet_transactions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wallet_transactions` ADD CONSTRAINT `wallet_transactions_matchId_matches_id_fk` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `admin_audit_entity_idx` ON `admin_audit_logs` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`userId`);--> statement-breakpoint
CREATE INDEX `challenges_open_idx` ON `challenges` (`status`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `dispute_match_idx` ON `disputes` (`matchId`);--> statement-breakpoint
CREATE INDEX `dispute_status_idx` ON `disputes` (`status`);--> statement-breakpoint
CREATE INDEX `match_evidence_match_idx` ON `match_evidence` (`matchId`);--> statement-breakpoint
CREATE INDEX `match_participant_match_idx` ON `match_participants` (`matchId`);--> statement-breakpoint
CREATE INDEX `notification_owner_idx` ON `notifications` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `wallet_tx_owner_idx` ON `wallet_transactions` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `wallet_tx_match_idx` ON `wallet_transactions` (`matchId`);