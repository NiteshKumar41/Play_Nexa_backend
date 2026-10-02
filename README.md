# Play Nexa Backend

The backend for the Play Nexa React application. It uses Express, MongoDB, and Mongoose. Authentication uses bcryptjs and JSON Web Tokens. Wallet and game operations are handled only by backend services.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure `.env` using `.env.example`. Keep `.env` private. Set `MONGODB_URI`, `JWT_SECRET` (at least 32 characters), `JWT_EXPIRES_IN`, and `CLIENT_URL`. The legacy `MONGO_URI` and `FRONTEND_URL` names remain supported during migration.

3. MongoDB must run as a replica set because signup and wallet balance changes use MongoDB transactions. For a local single-node development replica set, add this to your MongoDB configuration:

   ```yaml
   replication:
     replSetName: rs0
   ```

   Restart MongoDB, then initialize the replica set once:

   ```bash
   mongosh --eval 'rs.initiate()'
   ```

   Set `MONGODB_URI` to include `replicaSet=rs0`. Wait for the local replica set to become primary before starting the backend.

4. Start the backend:

   ```bash
   npm run dev
   ```

   For a normal start, use `npm start`.

## Health check

Visit `http://localhost:5000/health` (or the backwards-compatible `/api/health`). A successful response is:

```json
{
  "success": true,
  "message": "Play Nexa backend is healthy"
}
```

## Security

The backend applies Helmet security headers, bounded request bodies, CORS origin restrictions, and per-IP API/authentication/financial-write rate limits. JWTs contain only the user ID; account status and role are read from MongoDB. Read [SECURITY.md](./SECURITY.md) for upload validation, financial safeguards, deployment requirements, and known limitations.

## Authentication API

All authentication endpoints use `/api/v1/auth`:

- `POST /signup` creates a player and a zero-balance wallet in one database transaction.
- `POST /login` authenticates with a phone number and six-digit password.
- `GET /me` returns the current account and requires a Bearer token in the `Authorization` header.

Signup requires `fullName`, a 10-digit Indian `phone`, and a six-digit numeric `password`. `email`, `dob`, `gender`, and `upiId` are optional. Passwords are hashed and never included in API responses.

## Wallet API

Wallet routes require authentication. The backend identifies the wallet from the verified user in the JWT; clients cannot request another user's wallet.

- `GET /api/v1/wallet` returns the current user's wallet.
- `GET /api/v1/wallet/transactions?page=1&limit=10` returns the current user's paginated transaction history.

There is no public endpoint that directly sets or credits a wallet balance. Deposits are reviewed by an admin and withdrawals reserve funds transactionally (see their sections below).

A wallet holds the current balance. Wallet transactions are kept in a separate collection as the audit history of each balance change. React must never set the wallet balance: it can only read the wallet through the API. `walletService` validates operations and applies credits or debits. MongoDB transactions commit the balance update and its transaction record together, so one cannot persist without the other.

`balanceBefore` and `balanceAfter` record the balance immediately before and after an operation. Transaction types describe the operation (such as `ADD_MONEY` or `GAME_CREATE`); status records its outcome. Deposit requests enter `PENDING` and only change the balance after admin approval. Withdrawals reserve the requested balance and are later marked successful or refunded after admin processing.

Debit operations reject an amount greater than the available balance with `422 Insufficient wallet balance`, and do not create a successful ledger entry.

## Game catalog API

Players can browse active games using `GET /api/v1/games` or retrieve an active game using `GET /api/v1/games/:id`. Admin users can also retrieve inactive games.

Admin routes require a valid JWT and a user whose database role is `admin`:

- `POST /api/v1/games` creates a game with an explicit numeric `gameCode`, `name`, and optional `imageUrl`.
- `GET /api/v1/games/admin` lists all games.
- `PUT /api/v1/games/:id` updates `gameCode`, `name`, and/or `imageUrl`.
- `PATCH /api/v1/games/:id/status` updates `isActive`.
- `PATCH /api/v1/games/:id/open-status` updates `isOpen`.
- `DELETE /api/v1/games/:id` soft-deletes a game by setting both status flags to `false`.

`isActive` controls visibility in the player catalog. `isOpen` records whether a game can later be used for matchmaking. These flags are independent: deactivating a game does not automatically change its open status. Soft deletion closes and deactivates the game while preserving its historical record. `createdBy` and `updatedBy` are derived from the authenticated user, not from request data.

A Game is a catalog entry such as Ludo. A Match is one 1v1 session for a selected game and entry fee. The game catalog controls which games can be selected; a match stores the players, reserved entry amounts, lifecycle status, and room code.

## Matchmaking API

All matchmaking endpoints require a valid JWT:

- `POST /api/v1/matches` with `{ "gameId": "...", "entryFee": 50 }` creates an `ACTIVE` match. The game must be active and open, the user must be active and unblocked, and the entry fee must be a positive number.
- `GET /api/v1/matches?gameId=...&page=1&limit=10` returns the newest open matches for a game. Only `ACTIVE` matches without a second player appear.
- `GET /api/v1/matches/:matchId` returns match details, including the room code, without exposing wallet transaction IDs.
- `POST /api/v1/matches/:matchId/join` joins an `ACTIVE` match. The backend charges Player 2 the exact same amount Player 1 paid. A game must still be active, but it may have been closed to new matches after the creator made this one.
- `PATCH /api/v1/matches/:matchId/room-code` with `{ "roomCode": "123456" }` lets only Player 1 set a non-empty room code after the match is joined.
- `POST /api/v1/matches/:matchId/leave` lets Player 2 leave and receive a full refund only before a room code is set.
- `POST /api/v1/matches/:matchId/cancel` lets Player 1 cancel and receive a full refund only while the match is active and no opponent has joined.

Creating and joining each run inside a MongoDB transaction. Wallet changes go through `walletService`; the wallet balance, successful wallet transaction record, and corresponding match change therefore commit or roll back together. Leaving and cancelling use the same transactional rule and record a `GAME_REFUND` transaction for every refund. MongoDB must be configured as a replica set for transactions (see Setup).

Match creation follows:

```text
React
  ↓ POST /matches
matchController
  ↓
matchService
  ↓
walletService
  ↓ MongoDB transaction
    ├── wallet debit
    ├── wallet transaction
    └── match creation
```

Joining follows the same route → controller → service → wallet service path. It debits Player 2, records the `GAME_JOIN` transaction, and conditionally updates the match to `JOINED` in one transaction. The conditional update on `status: ACTIVE` and an empty `player2` prevents competing join requests from both claiming the same match; a losing request rolls back its wallet debit and receives `409 Match is no longer available`.

The platform fee is based on the individual entry amount, not the total pool: an entry below ₹100 incurs 20%, and an entry of ₹100 or more incurs 3%. Once both players have joined, the match records the total pool, platform fee, and winner amount for information. An administrator later settles the claim, credits the approved winner, or refunds both players.

React integration is intentionally deferred until after this backend checkpoint. When connected, the client should request data and submit actions through these REST endpoints; the server remains authoritative for wallet balances, entry fees, match state, and financial values.

The implemented lifecycle at this point is:

```text
ACTIVE → JOINED → COMPLETED → DISPUTED (if the opponent challenges the claim)
                            → admin settlement → SETTLED
```

At creation, Player 1's entry is reserved; on joining, Player 2's equal entry is reserved. A permitted leave or cancellation returns the relevant entry to that player's wallet. No prize is paid when a match becomes `JOINED`, when a room code is set, when a winner claim is submitted, or when a dispute is opened. `COMPLETED` means a player has claimed a result; it does not mean the match is financially settled. An admin later declares a winner or refunds both players through the settlement API.

## Results and disputes

`POST /api/v1/matches/:matchId/result` accepts multipart fields `winnerClaim=true`, `screenshot` (PNG/JPG/JPEG/WEBP, at most 5 MB), and optional `remarks`. The JWT identity determines which participant made the claim and which player's screenshot field is updated. The resulting match is `COMPLETED` with `winnerClaimStatus: PENDING`.

The opponent may submit `POST /api/v1/matches/:matchId/dispute` with a required `reason` and `screenshot`. That changes the match to `DISPUTED`; the original winner claim remains pending for review. Only a participant or an admin may retrieve result records or evidence. Screenshots are kept under `uploads/game-results/` and served through authenticated evidence routes rather than public static URLs.

Admins can list reviewable claims and disputes using `GET /api/v1/matches/admin/results?page=1&limit=20`; the queue validates pagination and returns pagination metadata.

An accepted screenshot is evidence, not automatic proof of a win. A claim or dispute does not change wallet balances or create `GAME_WIN` transactions. `COMPLETED` is a result-claim state; `SETTLED` means an administrator has finalized the financial outcome.

Socket.IO sends `result_submitted`, `dispute_submitted`, and `match_result_updated` to participants in the private match room after the REST update succeeds. The clients refetch the result through REST so MongoDB remains the source of truth.

## Deposits and payment methods

Deposits are a two-step process: the player submits a payment reference and proof, then an administrator verifies the payment. Submission creates an `ADD_MONEY` wallet transaction in `PENDING` state and does not change the wallet. Only approval changes the wallet. Approval re-reads the current wallet balance and atomically updates that balance and the pending ledger record to `SUCCESS`; rejection changes the record to `FAILED` and does not debit or credit the wallet.

Player endpoints (all require a JWT):

- `GET /api/v1/payment-methods/active` returns the active UPI ID, payee name, and optional QR URL.
- `POST /api/v1/wallet/deposits` accepts multipart fields `amount`, optional `upiApp`, optional `upiTransactionId`, and required image field `proof` (JPG/JPEG/PNG/WEBP, at most 5 MB).
- `GET /api/v1/wallet/deposits?page=1&limit=20&status=PENDING&from=2026-10-02&to=2026-10-02` returns the signed-in player's deposits. Date boundaries use IST days.
- The returned `proofUrl` is a protected API URL; only the owning player or an admin can retrieve it.

Admin endpoints require the existing `admin` role:

- `GET /api/v1/admin/deposits/pending` lists pending requests, oldest first.
- `GET /api/v1/admin/deposits` supports `status`, `userId`, `from`, `to`, `page`, `limit`, and `search` (user name, phone, or UPI transaction ID).
- `GET /api/v1/admin/deposits/:transactionId` returns deposit, user, and processing information.
- `POST /api/v1/admin/deposits/:transactionId/approve` approves and credits a pending deposit exactly once.
- `POST /api/v1/admin/deposits/:transactionId/reject` requires a 5-500 character `reason`.
- `GET /api/v1/admin/payment-methods`, `POST /api/v1/admin/payment-methods`, `PATCH /api/v1/admin/payment-methods/:id`, `PATCH /api/v1/admin/payment-methods/:id/activate`, and `DELETE /api/v1/admin/payment-methods/:id` manage payment methods. Create/update may include an optional multipart `qrImage`. Methods are created inactive; the activate endpoint atomically deactivates any other active method. An active method cannot be deleted.

Uploaded proofs and QR images are stored under the ignored `uploads/` directory using generated names, validated against both MIME/extension and image signatures, and served only through authenticated routes. A user's UPI transaction reference is unique per user when provided, preventing accidental duplicate submissions. The `deposit_approved` and `deposit_rejected` Socket.IO events are emitted to the player's authenticated `user:<userId>` room after the database update; their payload contains only transaction ID, amount, and status.

## Withdrawals and manual payouts

A withdrawal reserves the requested funds immediately: creating a withdrawal conditionally debits the player's wallet and creates a `WITHDRAW` transaction in `INITIATED` state in one MongoDB transaction. An admin manually sends the payout outside this system and then records the provider UTR through the success endpoint; this checkpoint does not integrate a payment gateway.

Player endpoints (JWT required):

- `POST /api/v1/wallet/withdrawals` accepts `{ "amount": 1000, "upiId": "player@upi", "upiApp": "Google Pay", "clientRequestId": "optional-unique-request-id" }`.
- `GET /api/v1/wallet/withdrawals?page=1&limit=20&status=INITIATED&from=2026-10-02&to=2026-10-02` returns only the signed-in player's withdrawal history. Date filters use IST day boundaries.

Admin endpoints (JWT and `admin` role required):

- `GET /api/v1/admin/withdrawals/pending` lists initiated withdrawals oldest first.
- `GET /api/v1/admin/withdrawals` supports `status`, `userId`, `from`, `to`, `page`, `limit`, and search across player name/phone, destination UPI ID, and UTR.
- `GET /api/v1/admin/withdrawals/:transactionId` returns withdrawal and player details.
- `POST /api/v1/admin/withdrawals/:transactionId/success` requires `upiTransactionId` and optionally accepts `remarks`; it records the admin and processing time without another wallet deduction.
- `POST /api/v1/admin/withdrawals/:transactionId/reject` requires a 5-500 character `reason`; it atomically refunds the reserved amount and marks the transaction `FAILED`.

Withdrawal lifecycle: `INITIATED` means the amount is deducted and awaiting manual payout; `SUCCESS` means an admin recorded a completed payout and its UTR; `FAILED` means an admin rejected the payout and the amount was returned to the wallet. Only `INITIATED` can transition to either terminal status. Supplying a `clientRequestId` makes retries of the same player's identical request idempotent; reuse with different withdrawal details is rejected. The partial unique ledger index enforces that request ID per player.

After the status change commits, Socket.IO sends `withdrawal_success` or `withdrawal_failed` to the user's authenticated `user:<userId>` room. Events contain only transaction ID, amount, and status; clients can then refresh the wallet and withdrawal history through REST.

## Support tickets

Players can create and list their own tickets using `POST /api/v1/support/tickets` and `GET /api/v1/support/tickets?status=OPEN&page=1&limit=20`; `GET /api/v1/support/tickets/:ticketId` returns a ticket they own. Ticket creation accepts multipart `subject`, `description`, optional `transactionId`, and optional image field `image` (JPG/JPEG/PNG/WEBP, maximum 5 MB). A referenced transaction must belong to the authenticated player. Ticket images use generated filenames under `uploads/support/` and are served through an authenticated owner/admin route.

Admin routes require a valid JWT and the existing `admin` role:

- `GET /api/v1/admin/support/tickets` supports `status`, `userId`, IST `from`/`to`, `page`, `limit`, and `search` across ticket ID, user name/phone, subject, or transaction ID.
- `GET /api/v1/admin/support/tickets/:ticketId` returns the ticket, user contact details, and safe transaction summary when provided.
- `PATCH /api/v1/admin/support/tickets/:ticketId/status` moves an `OPEN` ticket to `IN_PROGRESS`.
- `POST /api/v1/admin/support/tickets/:ticketId/resolve` accepts a 5-2000 character `resolution` for an `OPEN` or `IN_PROGRESS` ticket.
- `POST /api/v1/admin/support/tickets/:ticketId/close` closes a resolved ticket only.
- `POST /api/v1/admin/support/tickets/:ticketId/reopen` reopens a `CLOSED` ticket as `OPEN`. The last resolution and audit timestamps remain as historical context.
- `PATCH /api/v1/admin/support/tickets/:ticketId/assign` accepts `{ "adminId": "..." }` and assigns an open or in-progress ticket to an active admin.

Ticket lifecycle: `OPEN` means submitted; `IN_PROGRESS` means an admin is handling it; `RESOLVED` means an admin provided a resolution; `CLOSED` means the resolved ticket is complete. Status transitions are conditional database updates, and transitions outside the supported flow are rejected. New ticket notifications go to the authenticated `admins` Socket.IO room using `support_ticket_created`. Ticket updates and resolutions notify the owner through `support_ticket_updated` and `support_ticket_resolved`; event payloads contain only ticket ID and status.

## Admin settlement and financial finalization

The following endpoints require a valid JWT and the existing database role `admin`:

- `GET /api/v1/admin/matches/pending-settlement` returns `COMPLETED` and `DISPUTED` matches, oldest pending first.
- `POST /api/v1/admin/matches/:matchId/settle` accepts one of:
  - `{ "action": "DECLARE_WINNER", "winnerUserId": "..." }`
  - `{ "action": "REFUND_BOTH", "reason": "optional explanation" }`
  - `{ "action": "REJECT_CLAIM", "reason": "required explanation, 5-500 characters" }`
- `GET /api/v1/admin/matches/settled` lists `SETTLED` and `CANCELLED` matches with settlement audit fields.
- `GET /api/v1/admin/matches/:matchId/settlement` returns match evidence, financial details, admin audit information, and associated wallet transaction records.

The admin can declare only one of the match participants as winner. For an undisputed `COMPLETED` match, that winner must equal the submitted claim. For a `DISPUTED` match, the admin may select either participant; this is an explicit review override. `REFUND_BOTH` and `REJECT_CLAIM` refund both entry amounts. Rejecting a claim also records the reason and marks the claim `REJECTED`.

Financial values are recalculated from the stored player entry amounts. The entries must both be valid, equal, and consistent with the recorded prize pool:

| Player entries | Pool | Fee rate | Platform fee | Winner payout |
| --- | ---: | ---: | ---: | ---: |
| ₹50 + ₹50 | ₹100 | 20% | ₹20 | ₹80 |
| ₹100 + ₹100 | ₹200 | 3% | ₹6 | ₹194 |

The platform fee is stored on the match as platform revenue; this implementation does not create or credit an admin/platform wallet. Settlement and refunds run through `walletService` in the same MongoDB transaction as their successful `GAME_WIN` or `GAME_REFUND` records and the final match update. Unique partial indexes on match transaction references prevent a second payout or duplicate per-player refund. A repeated refund request is rejected with `409`; the original per-player credits and ledger records are never repeated. An already settled winner payout is also rejected.

Settlement audit fields record who finalized the match, when, what action was taken, the reason, and the transaction IDs. The Socket.IO events `match_settled`, `match_refunded`, and `match_claim_rejected` are emitted only after the database transaction commits and never include wallet balances.

Lifecycle meanings:

- `COMPLETED`: a player submitted a winner claim; it is awaiting admin review.
- `DISPUTED`: the opponent challenged that claim; it is awaiting admin review.
- `SETTLED`: an admin finalized the winner and financial payout.
- `CANCELLED`: the match was refunded (or cancelled earlier in the lifecycle).

Money remains stored as JavaScript/MongoDB numbers for compatibility with the current wallet schema. Calculations normalize to two decimal places using integer cents internally. For production financial hardening, consider migrating persisted amounts to integer paise or MongoDB `Decimal128`.

## Realtime matchmaking

Socket.IO runs on the same HTTP server as Express. The browser authenticates the socket handshake with its existing JWT; the server verifies the token and confirms the user is still active and not blocked. Clients may join active game lobby rooms, while match rooms require the authenticated user to be Player 1 or Player 2.

REST performs operations and provides the initial page data. MongoDB stores the authoritative match and wallet state. After a REST operation has completed successfully, Socket.IO tells connected clients about the change:

The lobby first loads matches over REST, then joins `game:lobby:<gameId>` and listens for `match_created`, `match_joined`, `match_cancelled`, and `match_player_left`. The detail page loads via REST, then joins the private `match:<matchId>` room and listens for `match_updated`, `room_code_updated`, cancellation, and leave updates. If the socket reconnects, the client rejoins its active rooms. An unauthorized room request returns `socket_error`; it does not change application data.

```text
CREATE MATCH
React → POST /api/v1/matches → MongoDB creates match
                             → Socket.IO: match_created
                             → React updates lobby

JOIN MATCH
React → POST /api/v1/matches/:id/join → MongoDB updates match + wallet
                                      → Socket.IO: match_joined
                                      → React updates lobby/detail

ROOM CODE
React → PATCH /api/v1/matches/:id/room-code → MongoDB stores room code
                                             → Socket.IO: room_code_updated
                                             → React shows room code
```

Socket.IO only notifies clients; it never creates a match or changes wallet state. A disconnected socket does not affect REST operations or database state. The current single Node.js server and Socket.IO instance are appropriate for this application. If the backend later runs as multiple instances, a shared Socket.IO adapter such as Redis may be needed; horizontal scaling and Redis are not part of this checkpoint.

## Admin APIs

Every `/api/v1/admin/*` route requires a valid JWT and a user whose stored database role is `admin`. The server does not use a role supplied in the request body. Admin actions use the authenticated user ID for audit fields.

The admin API groups are:

| Group | Endpoints |
| --- | --- |
| Dashboard | `GET /api/v1/admin/dashboard/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` |
| Deposits | `GET /api/v1/admin/deposits/pending`, `GET /api/v1/admin/deposits`, `GET /api/v1/admin/deposits/:transactionId`, `POST /api/v1/admin/deposits/:transactionId/approve`, `POST /api/v1/admin/deposits/:transactionId/reject` |
| Withdrawals | `GET /api/v1/admin/withdrawals/pending`, `GET /api/v1/admin/withdrawals`, `GET /api/v1/admin/withdrawals/:transactionId`, `POST /api/v1/admin/withdrawals/:transactionId/success`, `POST /api/v1/admin/withdrawals/:transactionId/reject` |
| Matches | `GET /api/v1/admin/matches/pending`, `GET /api/v1/admin/matches/disputed`, `GET /api/v1/admin/matches/:matchId`, and the `declare-winner`, `refund`, and `reject-claim` POST actions |
| Games | `GET/POST /api/v1/admin/games`, `GET/PATCH/DELETE /api/v1/admin/games/:gameId` |
| Payment methods | `GET/POST /api/v1/admin/payment-methods`, `PATCH/DELETE /api/v1/admin/payment-methods/:paymentMethodId` |
| Users | `GET /api/v1/admin/users`, `GET /api/v1/admin/users/:userId`, and PATCH `status`, `block`, and `role` actions |
| Support | `GET /api/v1/admin/support/tickets`, `GET /api/v1/admin/support/tickets/:ticketId`, and PATCH/POST `status`, `resolve`, `close`, and `reopen` actions |

Admin list endpoints use `page` and `limit` query parameters (default 1 and 20, maximum 100) and return a pagination object. Deposit and withdrawal lists also support `status`, `from`, `to`, and `search`; user lists support `search`, `active`, `blocked`, and `userType`. Date-only filters use the shared IST/UTC+05:30 date utility. Dashboard financial totals use the selected range; its operational counts are current totals.

Game creation and updates accept `multipart/form-data`; the optional image field is named `image`. Text fields are `name`, numeric `gameCode`, boolean `status`, and boolean `isOpen`. Uploaded game images are validated and stored under `uploads/games`; only images attached to an active game are served publicly. Game deletion is a soft deactivation so match history keeps its game reference.

Deposit approval, withdrawal rejection, and match settlement/refund reuse their existing service-layer MongoDB transactions and wallet service operations. Settlement and payment-method activation emit or update state only after their transaction succeeds. The payment-method collection has a partial unique index that permits at most one active method. Demoting, deactivating, or blocking an active admin is transactionally guarded so at least one active, unblocked admin remains.

Dashboard metrics aggregate existing Users, WalletTransactions, Games, GameMatches, and SupportTickets collections; no dashboard-specific copies are maintained. During the later integration checkpoint, React can call these endpoints with its authenticated bearer token, render the returned data, and use pagination values to request additional pages. The server—not the client—enforces admin privileges and performs wallet updates and settlement calculations.

## Architecture

```text
React (future integration)
  ↓ JWT
authMiddleware
  ↓
controller
  ↓
service
  ↓
model
  ↓
MongoDB
```

Game requests follow the same route → controller → service → model path, with backend admin authorization protecting write operations. Matchmaking keeps its business rules in `matchService` and delegates all wallet mutations to `walletService`; clients never write wallet balances directly. The general request flow is React → Express route → controller → service → model → MongoDB.

## Folder structure

```text
src/
├── config/       Database, environment, CORS, and upload configuration
├── constants/    Wallet transaction and match statuses
├── controllers/  HTTP request handlers
├── middleware/   Authentication, admin authorization, uploads, and error handling
├── models/       User, wallet, wallet transaction, game, and match schemas
├── routes/       Versioned Express API routes
├── services/     Authentication, wallet, payment, game, match, and support business logic
├── socket/       Socket.IO authentication, rooms, event names, and emitters
├── utils/        JWT, file storage, dates, and financial helpers
├── app.js        Express application configuration
└── server.js     Environment loading, database connection, and server startup
```

For real-money use, consider storing currency in integer minor units (paise) instead of JavaScript floating-point numbers.

## Testing and available scripts

- `npm run dev` starts the backend with nodemon.
- `npm start` starts the backend normally.
- `npm test` runs the Node.js integration suite. It uses `MONGODB_URI_TEST`, which must point to a disposable MongoDB replica-set database whose name contains `test`; the suite drops that database before and after execution.

Example:

```bash
MONGODB_URI_TEST="mongodb://127.0.0.1:27017/play_nexa_test?replicaSet=rs0" npm test
```

The backend has no separate compile/build step. Check JavaScript syntax with:

```bash
find src test -name '*.js' -print0 | xargs -0 -n1 node --check
```

Run `npm audit` during dependency maintenance. Production deployment requirements, including HTTPS, MongoDB authentication, and secret management, are listed in [SECURITY.md](./SECURITY.md).
