# Pace Arena

A responsive football-game challenge platform for eFootball/PES and EA Sports FC/FIFA, initially serving players in Kenya. Registration gives immediate access without email verification or a starter balance. New challenges use KES only when server-side wallet and wagering gates are enabled. Pace Arena is independent and is not affiliated with game publishers.

## Money movement boundary

The separate partner website owns checkout and any M-Pesa STK flow. Pace Arena does not initiate checkout/STK. A player's KES wallet is credited only when the partner server sends a valid signed event after confirming settlement. The application does not send withdrawal money: an administrator sends the M-Pesa payment externally from the approved business account, then records the actual amount, receipt/reference and reason. Pending requests are not payouts.

KES gates default off. Do not enable them until the partner contract, callback configuration, operational controls, required legal review and payment-provider approvals have been independently confirmed for the relevant businesses and activities. The owner has stated they have a license and a separate licensed site; Pace Arena has not verified that license, its holder, scope or whether it covers this application. This repository makes no licensing or compliance claim.

## Stack and development

This project uses React/Vite, Wouter, typed tRPC, Express, Drizzle and the Manus-managed MySQL-compatible database. Node, pnpm and dependencies are pinned in the repository. The development server listens on `PORT` (default `3000`).

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

The development and published deployments use the same managed database. Treat migrations and all development writes as production data changes. The production server binds its health endpoint first, reports `503 starting` and blocks API traffic while it applies only pending checked-in journal migrations under a MySQL advisory lock, releases the migration connection, then reports healthy and starts timeout processing. The developer `pnpm dev` command never auto-migrates; use `pnpm db:migrate` deliberately when a shared-schema change is intended. Apply checked-in migrations only; do not use sample users, mock wallets, live partner events, payout tests or destructive acceptance testing against this shared database.

## Configuration

Use protected project secrets for hosted credentials. `.env.example` contains placeholders only. The platform injects `DATABASE_URL`, `MANUS_API_URL`, `MANUS_API_KEY`, project identity and signed-cookie configuration; keep them server-side.

- `PACE_SMTP_USERNAME`, `PACE_SMTP_APP_PASSWORD`, `PACE_SMTP_FROM`, or optional `PACE_SMTP_URL`: password-reset mail only; registration/login do not send email.
- `PACE_KES_WALLET_ENABLED=true`: wallet actions remain unavailable unless the partner URL, at least 32 bytes of shared HMAC secret and all configured positive KES limits are valid.
- `PACE_REAL_WAGERING_ENABLED=true`: independently enables new KES wagers only when the KES wallet configuration is valid.
- `PACE_PARTNER_CALLBACK_SECRET`: shared server-only HMAC-SHA256 key. Configure it as a protected secret on both servers; never place it in frontend code, a repository or chat.
- `PACE_CREDIT_PARTNER_URL`: HTTPS purchase page on the external partner site.
- `PACE_KES_MIN_DEPOSIT`, `PACE_KES_MAX_DEPOSIT`, `PACE_KES_MIN_STAKE`, `PACE_KES_MAX_STAKE`, `PACE_KES_MIN_WITHDRAWAL`, `PACE_KES_MAX_WITHDRAWAL`: positive whole-shilling bounds; the stake range must remain within KES 10–5,000.
- `PORT`: listener port; defaults to 3000.

The partner callback contract and example payload/signing format are in [PARTNER_INTEGRATION.md](PARTNER_INTEGRATION.md). Do not send a browser redirect or user-entered receipt as credit evidence. Callbacks use `POST /api/partner/v1/credit-events`, a five-minute timestamp window, exact raw-body signing, constant-time HMAC comparison, event/transaction deduplication and atomic wallet-ledger updates. Signed reversals that cannot safely debit funds freeze the wallet for audited administrator review.

## Manual M-Pesa withdrawals

A player enters a KES amount and Kenyan M-Pesa number. The server normalizes the number, verifies wallet eligibility and limits, then reserves the amount atomically. An administrator sends money outside Pace Arena and records the external receipt/reference, actual amount and reason; or rejects with a reason and releases the reservation. The system never submits a payout transfer. A frozen wallet cannot be paid out until reversal review is resolved.

## Authentication and authorization

Pace Arena uses email/password credentials without an email-verification step and opaque server sessions in the `pace_arena_session` cookie. Successful registration signs the player in immediately and creates no demo-credit grant. Public HTTPS Preview traffic uses `SameSite=None; Secure` based on the forwarded public protocol; local plain-HTTP handling is separate. Password reset still requires configured email delivery. Administrator roles are never granted by email matching; an existing administrator must perform reason-required, audited role changes, and cannot remove the final administrator.

For a fresh database with no administrator, a trusted database operator must provision the first admin role once. Email addresses and identity-provider upserts never bootstrap administrator access.

## Migrations and persistent data

`drizzle/schema.ts` is the source schema; `drizzle/*.sql` and `drizzle/meta/_journal.json` are the committed versioned migration history. Production startup applies only pending journal entries under a MySQL advisory lock while readiness remains `503`. The startup runner can recover the observed 0006 failure only when every expected KES table, column, index and earlier foreign key is already present: it adds the two missing short-name foreign keys and records the completed migration; any other partial shape fails closed instead of replaying duplicate DDL. `pnpm db:migrate` uses the same locked runner for deliberate manual application; developer startup still does not migrate automatically. The KES migration preserves existing challenge rows as `DEMO`; it does not convert demo balances or transactions into KES. Existing historical records should be retained. Before manual/export operations, make a separately stored encrypted backup using an authorized MySQL client and rehearse restoration outside the live application. The managed platform does not provide a separate dev database or built-in database backup/restore API.

## Match evidence, privacy and records

The managed MySQL service does not provide native row-level-security policies. Server-side user-scoped relationship checks and role middleware authorize application reads and writes. Screenshot evidence and match recordings are private and accessed through authenticated participant/admin routes. Gameplay screen capture is explicit and browser-consented on supported desktop browsers, starts only after the server marks the match in progress, has no microphone audio, and can be stopped by the player. Console/mobile players may upload a locally recorded clip. Video is encrypted in a temporary database record and is supplementary evidence, not cryptographic proof or automatic scoreboard OCR. Undisputed clips expire five minutes after the evidence window; review/dispute clips are retained until resolution, then expire five minutes later. Database-row deletion cannot guarantee removal from backups.

Historical demo wallets/ledgers and any original demo matches are non-cash records. New demo grants, deposits, withdrawals and challenge creation/acceptance are retired. Never convert demo balances into KES.

## Routes, health and production

The client route list is maintained in `client/public/manus-routes.json` and should match `client/src/App.tsx`. Unknown paths render the not-found page; `/api/health` is the unauthenticated readiness endpoint. Run `pnpm check`, `pnpm test` and `pnpm build` before a checkpoint. Production start is `pnpm start`; the listener honors `PORT`. The checked-in `Dockerfile` builds the frontend and server for managed container deployment. A checkpoint is a saved commit on the project's canonical `main` branch; checkpointing and publishing are separate actions.

Notifications are persisted in-app, not guaranteed browser push. Compatibility checks use selected editions and platforms and do not assume cross-play. Timeout processing rechecks database state before transitions. Do not describe the product as licensed or compliant without independent verification.
