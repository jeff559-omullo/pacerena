# Pace Arena

A responsive football-game challenge platform for eFootball/PES and EA Sports FC/FIFA. The initial environment is Kenya. All wallet balances are **simulated demo credits with no monetary value**: no purchases, deposits, withdrawals, cash prizes, cash-out or payments are implemented. The site is independent and is not affiliated with game publishers.

Email verification is not required. Registration creates the account, session and one-time, idempotent grant of 1,000 demo credits, recorded in the wallet ledger. Duplicate email addresses and usernames are rejected and the grant is tied to the account. The demo is rate-limited and not Sybil-proof across unrelated email addresses; it does not collect phone numbers, device fingerprints or precise location to try to link separate accounts. Because inbox ownership is not checked, do not use email address alone as proof of identity or to grant administrator privileges.

## Stack and development

This project uses React/Vite, Wouter, typed tRPC, Express, Drizzle and the Manus-managed MySQL-compatible database. Node, pnpm and dependencies are pinned in the repository. The development server listens on `PORT` (default `3000`).

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

The development and published deployments use the same managed database. Treat migrations and all development writes as production data changes. Only apply checked-in additive migrations; do not use sample users, hidden mock wallets or destructive acceptance testing against this database.

## Configuration

Copy `.env.example` for a separately hosted local environment. In the managed project, use protected project configuration for `PACE_SMTP_USERNAME`, `PACE_SMTP_APP_PASSWORD`, `PACE_SMTP_FROM` and the optional generic `PACE_SMTP_URL` fallback; do not commit or print their values. The platform injects `DATABASE_URL`, `MANUS_API_URL`, `MANUS_API_KEY`, the project identity and the signed-cookie secret. Keep these server-side.

- `DATABASE_URL`: managed MySQL-compatible connection string (provided by the project for development and production).
- `PACE_SMTP_USERNAME` and `PACE_SMTP_APP_PASSWORD`: preferred Gmail setup; the server enforces TLS on `smtp.gmail.com:587` and removes grouping spaces from Google's generated App Password. Use an App Password, never a normal Google account password.
- `PACE_SMTP_URL`: optional credentialed `smtp://` or `smtps://` fallback for non-Gmail providers, used only when the Gmail username/password pair is unset.
- `PACE_SMTP_FROM`: sender address/name that your SMTP provider authorizes.
- `PORT`: server listening port; defaults to 3000.

SMTP is not used during registration or login. If SMTP is unavailable, password-reset links cannot be delivered until mail is configured and checked. Administrator roles are never granted by email matching: an existing administrator must perform a reason-required role change in the operations desk, and each change is audited. Never paste credentials into source, chat, build-time frontend variables, or screenshots.

For a fresh database with no administrator, a trusted database operator must provision the first admin role once; after that, use the audited role controls in the operations desk. Email addresses and identity-provider upserts never bootstrap administrator access.

## Migrations and persistent data

`drizzle/schema.ts` is the source schema; `drizzle/*.sql` and `drizzle/meta/_journal.json` are the committed versioned migration history. Apply existing migrations with `pnpm db:migrate`. After intentional schema edits, generate and inspect a new migration, then apply it with the project migration command. Database and migration state persist across deploys, and development shares them with production. Before any manual/export operation, take a separately stored encrypted backup using an authorized MySQL client and rehearse restoration outside the live application. The managed platform does not provide a separate dev database or a built-in database backup/restore API.

## Authentication, privacy and evidence

Pace Arena uses email/password credentials without an email-verification step and opaque server sessions in the `pace_arena_session` cookie. Successful registration signs the player in immediately. Public HTTPS Preview traffic uses `SameSite=None; Secure` based on the forwarded public protocol; local plain-HTTP handling is separate. Normal player, match-participant and administrator authorization is checked on the backend. The browser receives no database or SMTP credential and cannot submit a role, resulting balance, or trusted match time. Since signup does not verify inbox ownership, each player must protect their password; password recovery still depends on receiving email.

The managed MySQL service does **not** provide native row-level-security policies. Data access is therefore guarded in the application server with user-scoped relationship checks, locked transactions and role middleware. The managed object store does not offer per-object ACLs either: screenshots are encrypted with AES-256-GCM, object keys remain server-side, metadata ties each object to an authorized match, and media is streamed only through authenticated participant/admin routes with `private, no-store` responses. Screenshots and user-entered scores are evidence—not independently authenticated game results. No transfer occurs when evidence conflicts or is missing; those cases require review.

## Routes, health and production

The client route list is maintained in `client/public/manus-routes.json` and must match `client/src/App.tsx`. Unknown paths render the not-found page; the Express server serves the SPA entry for application pages and `/api/health` is the unauthenticated readiness endpoint. Run `pnpm check`, `pnpm test` and `pnpm build` before a checkpoint. Production start is `pnpm start`; the listener honors `PORT`. The checked-in `Dockerfile` builds the frontend and server for the managed container deployment. A checkpoint is a saved commit on the project's canonical `main` branch; checkpointing and publishing are separate actions.

## Product boundaries

Administrators can pause **new** challenges, adjust the minimum/maximum permitted stake within the database-enforced 10–5,000 demo-credit ceiling, set a default match duration within 6–30 minutes, and post a short operational notice. Changes require a reason, are auditable, apply only to new challenges, and never change already agreed match terms. Real-money settings do not exist.

The application uses same-named game editions and specific platforms for matchmaking; it does not assume mobile/PC/PlayStation/Xbox cross-play compatibility. In-app notifications are persistent but are not browser push or guaranteed realtime. Timeout work runs in the application server and always rechecks the database state before taking action. Before any real-money feature in Kenya, obtain independent legal advice on regulatory classification/licensing and confirm selected payment-provider approval; this project makes no such licensing or compliance claim.
