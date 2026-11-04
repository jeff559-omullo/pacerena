ALTER TABLE `challenges` MODIFY `status` enum('open','accepted','expired','cancelled','rejected') NOT NULL DEFAULT 'open';
--> statement-breakpoint
ALTER TABLE `challenges` ADD `stakeCurrency` enum('DEMO','KES') NOT NULL DEFAULT 'DEMO';
--> statement-breakpoint
ALTER TABLE `profiles` ADD `cashWalletStatus` enum('unverified','pending','verified','rejected') NOT NULL DEFAULT 'unverified';
--> statement-breakpoint
CREATE INDEX `profile_cash_wallet_status_idx` ON `profiles` (`cashWalletStatus`);
--> statement-breakpoint
CREATE TABLE `kes_wallet_accounts` (
  `userId` int NOT NULL,
  `walletReference` varchar(40),
  `availableKes` int NOT NULL DEFAULT 0,
  `reservedKes` int NOT NULL DEFAULT 0,
  `frozen` int NOT NULL DEFAULT 0,
  `freezeReason` varchar(500),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `kes_wallet_accounts_userId` PRIMARY KEY (`userId`),
  CONSTRAINT `kes_wallet_available_nonnegative` CHECK (`availableKes` >= 0),
  CONSTRAINT `kes_wallet_reserved_nonnegative` CHECK (`reservedKes` >= 0),
  CONSTRAINT `kes_wallet_frozen_flag` CHECK (`frozen` IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kes_wallet_reference_unique` ON `kes_wallet_accounts` (`walletReference`);
--> statement-breakpoint
CREATE TABLE `kes_withdrawal_requests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `idempotencyKey` varchar(128) NOT NULL,
  `amountKes` int NOT NULL,
  `phoneE164` varchar(16) NOT NULL,
  `status` enum('pending','paid','rejected') NOT NULL DEFAULT 'pending',
  `payoutReceipt` varchar(64),
  `actualAmountKes` int,
  `reviewReason` varchar(2000),
  `requestedAt` timestamp NOT NULL DEFAULT (now()),
  `processedAt` timestamp,
  `processedBy` int,
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `kes_withdrawal_requests_id` PRIMARY KEY (`id`),
  CONSTRAINT `kes_withdrawal_amount_positive` CHECK (`amountKes` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kes_withdrawal_user_idempotency_unique` ON `kes_withdrawal_requests` (`userId`,`idempotencyKey`);
--> statement-breakpoint
CREATE INDEX `kes_withdrawal_owner_idx` ON `kes_withdrawal_requests` (`userId`,`requestedAt`);
--> statement-breakpoint
CREATE INDEX `kes_withdrawal_status_idx` ON `kes_withdrawal_requests` (`status`,`requestedAt`);
--> statement-breakpoint
CREATE TABLE `kes_wallet_transactions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `challengeId` int,
  `matchId` int,
  `withdrawalRequestId` int,
  `transactionType` enum('partner_credit','partner_reversal','partner_reversal_review','withdrawal_reservation','withdrawal_paid','withdrawal_release','stake_reservation','stake_release','winner_reward','draw_refund','stake_consumption','admin_adjustment') NOT NULL,
  `amountKes` int NOT NULL,
  `availableBeforeKes` int NOT NULL,
  `availableAfterKes` int NOT NULL,
  `reservedBeforeKes` int NOT NULL,
  `reservedAfterKes` int NOT NULL,
  `status` enum('completed','reserved','released','review') NOT NULL DEFAULT 'completed',
  `idempotencyKey` varchar(128) NOT NULL,
  `reason` varchar(1000) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `kes_wallet_transactions_id` PRIMARY KEY (`id`),
  CONSTRAINT `kes_wallet_tx_amount_positive` CHECK (`amountKes` > 0),
  CONSTRAINT `kes_wallet_tx_available_before_nonnegative` CHECK (`availableBeforeKes` >= 0),
  CONSTRAINT `kes_wallet_tx_available_after_nonnegative` CHECK (`availableAfterKes` >= 0),
  CONSTRAINT `kes_wallet_tx_reserved_before_nonnegative` CHECK (`reservedBeforeKes` >= 0),
  CONSTRAINT `kes_wallet_tx_reserved_after_nonnegative` CHECK (`reservedAfterKes` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kes_wallet_tx_idempotency_unique` ON `kes_wallet_transactions` (`userId`,`idempotencyKey`);
--> statement-breakpoint
CREATE INDEX `kes_wallet_tx_owner_idx` ON `kes_wallet_transactions` (`userId`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `kes_wallet_tx_challenge_idx` ON `kes_wallet_transactions` (`challengeId`);
--> statement-breakpoint
CREATE INDEX `kes_wallet_tx_match_idx` ON `kes_wallet_transactions` (`matchId`);
--> statement-breakpoint
CREATE TABLE `partner_credit_events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `eventId` varchar(128) NOT NULL,
  `transactionId` varchar(128) NOT NULL,
  `eventType` enum('credit','reversal') NOT NULL DEFAULT 'credit',
  `reversesTransactionId` varchar(128),
  `userId` int NOT NULL,
  `walletReference` varchar(40) NOT NULL,
  `amountKes` int NOT NULL,
  `currency` varchar(3) NOT NULL DEFAULT 'KES',
  `status` enum('credited','reversed','held_for_review','dismissed') NOT NULL DEFAULT 'credited',
  `partnerOccurredAt` timestamp,
  `receivedAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `partner_credit_events_id` PRIMARY KEY (`id`),
  CONSTRAINT `partner_credit_amount_positive` CHECK (`amountKes` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partner_credit_event_unique` ON `partner_credit_events` (`eventId`);
--> statement-breakpoint
CREATE UNIQUE INDEX `partner_credit_transaction_unique` ON `partner_credit_events` (`transactionId`);
--> statement-breakpoint
CREATE UNIQUE INDEX `partner_credit_reversal_unique` ON `partner_credit_events` (`reversesTransactionId`);
--> statement-breakpoint
CREATE INDEX `partner_credit_owner_idx` ON `partner_credit_events` (`userId`,`receivedAt`);
--> statement-breakpoint
ALTER TABLE `kes_wallet_accounts` ADD CONSTRAINT `kes_wallet_accounts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `kes_withdrawal_requests` ADD CONSTRAINT `kes_withdrawal_requests_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `kes_withdrawal_requests` ADD CONSTRAINT `kes_withdrawal_requests_processedBy_users_id_fk` FOREIGN KEY (`processedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `kes_wallet_transactions` ADD CONSTRAINT `kes_wallet_transactions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `kes_wallet_transactions` ADD CONSTRAINT `kes_wallet_transactions_challengeId_challenges_id_fk` FOREIGN KEY (`challengeId`) REFERENCES `challenges`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `kes_wallet_transactions` ADD CONSTRAINT `kes_wallet_transactions_matchId_matches_id_fk` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `kes_wallet_transactions` ADD CONSTRAINT `kes_wallet_transactions_withdrawalRequestId_kes_withdrawal_requests_id_fk` FOREIGN KEY (`withdrawalRequestId`) REFERENCES `kes_withdrawal_requests`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `partner_credit_events` ADD CONSTRAINT `partner_credit_events_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
