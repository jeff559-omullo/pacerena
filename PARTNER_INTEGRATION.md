# Pace Arena partner-credit integration

Pace Arena does not collect payments or initiate M-Pesa STK requests. The partner website owns purchases and sends a signed server-to-server event after it has independently confirmed a successful KES credit or a provider-confirmed reversal. Pace Arena credits only the authenticated player's KES wallet reference. Manual M-Pesa withdrawals are reviewed and recorded by Pace Arena administrators.

## Endpoint and headers

Send `POST /api/partner/v1/credit-events` with `Content-Type: application/json`. Sign the exact UTF-8 request bytes before sending; do not parse and re-serialize the JSON when calculating the signature.

- `X-Pace-Timestamp`: Unix timestamp in whole seconds, decimal digits.
- `X-Pace-Signature`: `sha256=` followed by a lowercase or uppercase 64-character hexadecimal HMAC-SHA256 digest.
- HMAC input: `<timestamp>.<raw-request-body>` (ASCII timestamp, a period, then the original body bytes).
- HMAC key: the shared `PACE_PARTNER_CALLBACK_SECRET`, configured as a protected server secret in both systems. Use at least 32 random bytes; never put it in the browser or repository.
- Requests more than five minutes from server time are rejected. Retry with a fresh timestamp and the same event and transaction IDs.

Credit example:

```json
{
  "eventId": "evt_20261103_0000001",
  "transactionId": "partner_txn_20261103_0000001",
  "eventType": "credit",
  "walletReference": "PA0123456789ABCDEF0123456789ABCD",
  "amountKes": 500,
  "currency": "KES",
  "status": "paid",
  "occurredAt": "2026-11-03T17:00:00.000Z"
}
```

A reversal uses a new `eventId` and `transactionId`, sets `eventType` to `reversal`, and includes `reversesTransactionId` equal to the original partner credit's `transactionId`. Its wallet reference and `amountKes` must exactly match the original. Event IDs and transaction IDs must each be unique and 8–128 characters from letters, digits, `.`, `_`, `:`, and `-`. Wallet references are exact, case-sensitive values shown to the player. Amounts are positive whole KES, currency must be `KES`, and status must be `paid`. Unknown fields are rejected. A callback means the partner has already confirmed the underlying transaction; a browser redirect or a user-entered receipt is not sufficient.

## Responses and retry behavior

A new event committed to the wallet ledger returns HTTP 200 with `{ "ok": true, "duplicate": false }`. A reversal accepted into the admin review queue returns HTTP 200 with `reviewRequired: true` so the partner does not repeatedly send the same event. Repeated identical event IDs return HTTP 200 with `duplicate: true` without a second mutation. Reusing an event ID with different event data, reusing a transaction ID, replaying a reversal, an unknown wallet reference, a bad signature or invalid event data is rejected with a non-success response. Do not generate a new ID when retrying the same event.

A reversal is debited only when the full amount is still available and no funds are reserved. If those conditions fail, Pace Arena stores the signed event, freezes KES wagering/withdrawals for that wallet and raises it for an administrator; it never creates a negative balance. Admins may apply the reversal only after sufficient unreserved funds exist, or dismiss it with an audited reason.

Pace Arena stores event and transaction IDs, event type, wallet reference, KES amount, reversal link and receive time for reconciliation. It does not persist raw callback bodies or signatures. The event and wallet-ledger mutation are committed in one database transaction.

## Configuration and launch gates

`PACE_KES_WALLET_ENABLED` and `PACE_REAL_WAGERING_ENABLED` are server-only flags and default to `false`. Configure a strong callback secret and positive KES deposit, stake and withdrawal limits first. Real wagering remains disabled unless the wallet configuration is valid and the separate wagering flag is explicitly enabled. Set `PACE_CREDIT_PARTNER_URL` to the partner's HTTPS purchase page to show a buy-credits link; Pace Arena can still display a wallet reference for a manual partner checkout if the link is not set.

The partner site must decide what the applicable license covers. This callback is a technical integration contract, not verification or a claim of licensing, regulatory approval, legal compliance, or payment-provider approval by Pace Arena.
