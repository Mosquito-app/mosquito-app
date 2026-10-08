# Mosquito App Unity Football bridge

All funds are **sandbox Mosquito Wallet balances**, not live money.

## Security and configuration

The **private trusted Unity game server** is the match/score authority. A Unity
WebGL or mobile client is untrusted: never embed the server credential in a
build, C# script, downloadable configuration, browser storage or client logs.
The match JWT alone cannot debit wallets or authorize payout.

Configure:

- `UNITY_BRIDGE_SECRET`: a cryptographically random server-only secret of at
  least 32 characters. Store securely in this API and your private Unity server.
- `SESSION_SECRET`: the existing Mosquito secret, at least 32 characters. The API
  derives a domain-separated JWT signing key from it; do **not** share it with Unity.
- `UNITY_ALLOWED_ORIGINS`: comma-separated **exact origins** of your hosted
  WebGL build, e.g. `https://football.example.com`. No trailing slash or path,
  no wildcard. Native builds and private servers do not need CORS and may omit
  `Origin`. HTTPS is required for production integrations.

Missing/short authentication secrets fail closed with HTTP 503. Missing
allowed origins rejects cross-origin WebGL calls with HTTP 403. CORS is not
authentication; a script or native build cannot authorize payouts by omitting
its Origin header.

Your private Unity server must authenticate both Mosquito players and obtain
their agreement to the exact per-player stake before calling start. These
routes are not a replacement for player consent or server-authoritative game
simulation. Possessing the private bridge credential grants authority to debit
the specified accounts and settle their matches; protect it accordingly.

## API base

Use your Mosquito API's HTTPS origin followed by `/api`. Do not hardcode a
development origin into a distributed Unity build. The OpenAPI contract is
`lib/api-spec/openapi.yaml`; generated validators and clients stay in sync.

### 1. Start — trusted server only

`POST /api/match/start`

Headers:

```http
Content-Type: application/json
X-Unity-Server-Key: <private server credential>
Idempotency-Key: <new UUID for this match>
```

```json
{
  "player1Id": "<Mosquito player UUID>",
  "player2Id": "<different Mosquito player UUID>",
  "stakeAmount": 2000,
  "gameType": "football_11v11"
}
```

`stakeAmount` is the **whole NGN stake per player**, from 1 to 1,000,000.
Money is stored and calculated as integer kobo. No floating point balances.
Success returns HTTP 200:

```json
{
  "success": true,
  "matchId": "<match UUID>",
  "matchToken": "<signed match-scoped JWT>",
  "player1": { "id": "<player UUID>", "username": "player-one" },
  "player2": { "id": "<player UUID>", "username": "player-two" },
  "stakeAmount": 2000,
  "status": "ACTIVE",
  "tokenExpiresAt": "<ISO-8601 timestamp>"
}
```

Both wallet debits, wallet receipts, escrow locks and the ACTIVE match are
one PostgreSQL commit. Insufficient funds roll everything back.

**Retries:** reuse the exact same UUID header and payload after a network
failure. Concurrent retries return the same match without another debit.
Reusing that key with different participants/stakes returns 409. Keep this
UUID with the server's match record. Retrying start can reissue a JWT without
resetting an active or completed session; this also recovers an expired token.
Using a *different* UUID intentionally creates another funded match.

Give each Unity client the match ID and match token, never the server key.
The token is HS256, with a fixed issuer/audience, match ID subject, database
session ID binding and 24-hour expiration.

### 2. End — trusted server only

`POST /api/match/end` with Content-Type and X-Unity-Server-Key as above:

```json
{
  "matchId": "<match UUID>",
  "matchToken": "<match JWT>",
  "player1Score": 2,
  "player2Score": 1,
  "winnerId": "<player1 UUID>",
  "isDraw": false
}
```

Scores must be integers 0–99. The backend derives the winner from the scores:
`winnerId` must be that participant, not an outsider or the losing player.

```json
{
  "success": true,
  "message": "Escrow settled successfully",
  "winnerPayout": 3600,
  "commissionLogged": 400,
  "status": "COMPLETED",
  "overtime": false,
  "settled": true
}
```

Amounts returned are **NGN**, not kobo. The combined ₦4,000 pool pays ₦3,600
to the winner and ₦400 to the existing Mosquito platform commission wallet.
An identical result retry returns the same amounts without new ledger entries;
a conflicting result returns 409. Match close, credit and commission commit
together, with row locks and unique ledger constraints.

### Ties

Send equal scores, `"winnerId": null`, `"isDraw": true`. The configured rule
is `golden_goal`: status stays `ACTIVE`, `overtime: true`, `settled: false`,
and both returned financial amounts are zero. Escrow is **not** refunded or
settled on a draw. Continue the trusted server's simulation until the first
new goal, then report the final score and winner. That report must contain
exactly one new goal beyond the tied score. Duplicate tied reports are safe.

Six-minute timing (two three-minute halves), positions, goals, reconnections
and match abandonment recovery are the private Unity server's responsibility.
These REST routes are an escrow/result bridge, not a Unity physics server.
An interrupted game does not automatically choose a winner or refund funds.

### 3. Status — Unity clients or trusted server

`GET /api/match/status/<match UUID>`

Client header: `Authorization: Bearer <matchToken>`.
The private server may instead use `X-Unity-Server-Key`.

Returns the persisted status (`PENDING`, `ACTIVE`, `COMPLETED`, `CANCELLED`),
participant IDs, stake/pool, last reported scores, winner, overtime flag,
draw rule, settled amounts, timestamps and `sandboxOnly: true`.
Start immediately funds the session as ACTIVE; PENDING/CANCELLED are reserved
states, not additional public operations. Responses are `Cache-Control: no-store`.
Do not put JWTs in URLs. Poll about every 2–3 seconds with backoff on errors.

## Errors and logging

- 400: malformed/unsupported payload, invalid UUID key, contradictory result.
- 401: missing/invalid server key, forged/expired token or wrong match scope.
- 403: WebGL origin not allowlisted.
- 404: account/session unavailable.
- 409: insufficient funds, conflicting retry/result or improperly funded session.
- 503: authentication configuration missing.

Structured console logs include `unity.match_started`, `unity.match_overtime`,
`unity.match_settled`, `unity.request_rejected` and `unity.cors_rejected`.
They log match IDs, status and amounts, **not credentials, JWTs or request bodies**.
An idempotent retry can generate a second log line, not a second payout.

## Verification

```sh
pnpm --filter @workspace/api-server test tests/unity-match.test.ts
```

The tests clone a private disposable PostgreSQL schema and use synthetic
funds and ephemeral credentials. They do not charge Paystack, call a Unity
server or change public user wallets. They exercise real REST handlers,
concurrent funding/settlement, CORS, JWT validation, wallet totals and overtime.
