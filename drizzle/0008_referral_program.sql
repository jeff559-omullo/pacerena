ALTER TABLE users ADD COLUMN referralCode VARCHAR(16) NULL;

CREATE TABLE IF NOT EXISTS referral_settings (
  id INT PRIMARY KEY,
  enabled INT NOT NULL DEFAULT 1,
  defaultPercentage INT NOT NULL DEFAULT 5,
  fixedAmount INT NOT NULL DEFAULT 0,
  minimumQualifyingAmount INT NOT NULL DEFAULT 100,
  maxCommissionPerTransaction INT NOT NULL DEFAULT 500,
  maxLifetimeCommissionPerReferral INT NOT NULL DEFAULT 5000,
  approvalDelayHours INT NOT NULL DEFAULT 0,
  minWithdrawalAmount INT NOT NULL DEFAULT 100,
  rules TEXT NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS referrals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  referrerUserId INT NOT NULL,
  referredUserId INT NOT NULL,
  status ENUM('ACTIVE', 'PENDING', 'EXPIRED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  source ENUM('invite', 'manual', 'api') NOT NULL DEFAULT 'invite',
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expiresAt TIMESTAMP NULL,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY referral_referred_unique (referredUserId),
  KEY referral_referrer_idx (referrerUserId, createdAt),
  KEY referral_status_idx (status, createdAt),
  CONSTRAINT referral_referrer_fk FOREIGN KEY (referrerUserId) REFERENCES users(id),
  CONSTRAINT referral_referred_fk FOREIGN KEY (referredUserId) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS referral_commissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  referralId INT NOT NULL,
  referrerUserId INT NOT NULL,
  referredUserId INT NOT NULL,
  sourceType VARCHAR(32) NOT NULL,
  sourceTransactionId VARCHAR(128) NOT NULL,
  sourceAmountKes INT NOT NULL,
  percentage INT NOT NULL DEFAULT 0,
  fixedAmount INT NOT NULL DEFAULT 0,
  commissionAmountKes INT NOT NULL,
  status ENUM('PENDING', 'APPROVED', 'PAID', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  idempotencyKey VARCHAR(128) NOT NULL,
  reason VARCHAR(1000) NULL,
  eligibleAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approvedAt TIMESTAMP NULL,
  paidAt TIMESTAMP NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY referral_commission_idempotency_unique (idempotencyKey),
  KEY referral_commission_referrer_idx (referrerUserId, createdAt),
  KEY referral_commission_status_idx (status, createdAt),
  CONSTRAINT referral_commission_referral_fk FOREIGN KEY (referralId) REFERENCES referrals(id) ON DELETE CASCADE,
  CONSTRAINT referral_commission_referrer_fk FOREIGN KEY (referrerUserId) REFERENCES users(id),
  CONSTRAINT referral_commission_referred_fk FOREIGN KEY (referredUserId) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS referral_withdrawals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  amountKes INT NOT NULL,
  status ENUM('PENDING', 'APPROVED', 'PAID', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  reason VARCHAR(500) NULL,
  processedBy INT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processedAt TIMESTAMP NULL,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY referral_withdrawal_user_idx (userId, createdAt),
  KEY referral_withdrawal_status_idx (status, createdAt),
  CONSTRAINT referral_withdrawal_user_fk FOREIGN KEY (userId) REFERENCES users(id),
  CONSTRAINT referral_withdrawal_processor_fk FOREIGN KEY (processedBy) REFERENCES users(id)
);

CREATE UNIQUE INDEX user_referral_code_unique ON users(referralCode);
