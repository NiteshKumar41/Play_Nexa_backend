# Play Nexa Backend

The backend for the Play Nexa React application. It uses Express, MongoDB, and Mongoose. Authentication uses bcryptjs and JSON Web Tokens. Wallet and game operations are handled only by backend services.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure `.env` using `.env.example`. Keep `.env` private and use a long, random `JWT_SECRET`.

3. MongoDB must run as a replica set because signup and wallet balance changes use MongoDB transactions. For a local single-node development replica set, add this to your MongoDB configuration:

   ```yaml
   replication:
     replSetName: rs0
   ```

   Restart MongoDB, then initialize the replica set once:

   ```bash
   mongosh --eval 'rs.initiate()'
   ```

   The provided `MONGO_URI` includes `replicaSet=rs0`. Wait for the local replica set to become primary before starting the backend.

4. Start the backend:

   ```bash
   npm run dev
   ```

   For a normal start, use `npm start`.

## Health check

Visit `http://localhost:5000/api/health`. A successful response is:

```json
{
  "success": true,
  "message": "Play Nexa API is running"
}
```

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

There is no public endpoint to credit or debit a wallet in this checkpoint. Those operations are backend service functions only; real deposits and withdrawals are not implemented.

A wallet holds the current balance. Wallet transactions are kept in a separate collection as the audit history of each balance change. React must never set the wallet balance: it can only read the wallet through the API. `walletService` validates operations and applies credits or debits. MongoDB transactions commit the balance update and its transaction record together, so one cannot persist without the other.

`balanceBefore` and `balanceAfter` record the balance immediately before and after an operation. Transaction types describe the operation (such as `ADD_MONEY` or `GAME_CREATE`); status records its outcome. In a later payment checkpoint, a verified payment can call `creditWallet` with type `ADD_MONEY`. This checkpoint does not implement a payment gateway or withdrawal processing.

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

The platform fee is based on the individual entry amount, not the total pool: an entry below ₹100 incurs 20%, and an entry of ₹100 or more incurs 3%. Once both players have joined, the match records the total pool, platform fee, and winner amount for information. No winner is credited in this checkpoint.

The frontend [matchService.js](../playNexa/src/services/matchService.js) centralizes REST calls and maps the API's match data to the existing lobby/detail views. React may request a selected entry amount, but the server validates it and is the authority for wallet balances, the joining fee, match state, and financial values.

The implemented lifecycle at this point is:

```text
ACTIVE → JOINED → COMPLETED → DISPUTED (if the opponent challenges the claim)
                            → [Checkpoint 8: admin settlement] → SETTLED
```

At creation, Player 1's entry is reserved; on joining, Player 2's equal entry is reserved. A permitted leave or cancellation returns the relevant entry to that player's wallet. No prize is paid when a match becomes `JOINED`, when a room code is set, when a winner claim is submitted, or when a dispute is opened. `COMPLETED` means a player has claimed a result; it does not mean the match is financially settled.

## Results and disputes

`POST /api/v1/matches/:matchId/result` accepts multipart fields `winnerClaim=true`, `screenshot` (PNG/JPG/JPEG/WEBP, at most 5 MB), and optional `remarks`. The JWT identity determines which participant made the claim and which player's screenshot field is updated. The resulting match is `COMPLETED` with `winnerClaimStatus: PENDING`.

The opponent may submit `POST /api/v1/matches/:matchId/dispute` with a required `reason` and `screenshot`. That changes the match to `DISPUTED`; the original winner claim remains pending for review. Only a participant or an admin may retrieve result records or evidence. Screenshots are kept under `uploads/game-results/` and served through authenticated evidence routes rather than public static URLs.

An accepted screenshot is evidence, not automatic proof of a win. During this checkpoint, neither a claim nor a dispute changes wallet balances or creates `GAME_WIN` transactions. `COMPLETED` is a result-claim state; `SETTLED` will mean an administrator has finalized the financial outcome. Admin settlement and winner credit are intentionally deferred to Checkpoint 8.

Socket.IO sends `result_submitted`, `dispute_submitted`, and `match_result_updated` to participants in the private match room after the REST update succeeds. The clients refetch the result through REST so MongoDB remains the source of truth.

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

## Architecture

```text
React
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

Game requests follow the same route → controller → service → model path, with backend admin authorization protecting write operations. Matchmaking keeps its business rules in `matchService` and delegates all wallet mutations to `walletService`; neither the React client nor the match service writes wallet balances directly. The general request flow is React → Express route → controller → service → model → MongoDB.

## Folder structure

```text
src/
├── config/       Database configuration
├── constants/    Wallet transaction and match statuses
├── controllers/  HTTP request handlers
├── middleware/   Authentication, admin authorization, uploads, and error handling
├── models/       User, wallet, wallet transaction, game, and match schemas
├── routes/       Versioned Express API routes
├── services/     Authentication, wallet, game, match, and result business logic
├── socket/       Socket.IO authentication, rooms, event names, and emitters
├── utils/        JWT, file storage, and match financial helpers
├── app.js        Express application configuration
└── server.js     Environment loading, database connection, and server startup
```

For real-money use, consider storing currency in integer minor units (paise) instead of JavaScript floating-point numbers.
