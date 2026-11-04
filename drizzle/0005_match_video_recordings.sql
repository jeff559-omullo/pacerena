CREATE TABLE `match_video_recordings` (
	`id` int NOT NULL AUTO_INCREMENT,
	`matchId` int NOT NULL,
	`userId` int NOT NULL,
	`mimeType` enum('video/webm','video/mp4','video/quicktime') NOT NULL,
	`sizeBytes` int NOT NULL,
	`encryptedBytes` longblob NOT NULL,
	`uploadedAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp,
	CONSTRAINT `match_video_recordings_id` PRIMARY KEY(`id`),
	CONSTRAINT `match_video_recording_size` CHECK (`sizeBytes` >= 64 AND `sizeBytes` <= 33554432),
	CONSTRAINT `match_video_recordings_matchId_matches_id_fk` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE no action ON UPDATE no action,
	CONSTRAINT `match_video_recordings_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_video_recording_user_unique` ON `match_video_recordings` (`matchId`,`userId`);
--> statement-breakpoint
CREATE INDEX `match_video_recording_match_idx` ON `match_video_recordings` (`matchId`);
--> statement-breakpoint
CREATE INDEX `match_video_recording_expiry_idx` ON `match_video_recordings` (`expiresAt`);
