# Play Nexa Backend Security

## Authentication and authorization

Passwords/passcodes are hashed with bcrypt before storage. JWTs contain only
the account ID, use the configured expiry, and are signed and verified with
HS256. REST authentication reloads the account from MongoDB on each request,
so deactivated or blocked users and users whose admin role was removed cannot
continue using an old token.

Admin routes run authentication before admin authorization. Players can only
read their own wallets, transactions, tickets, and protected uploads. Match
actions verify participant or creator ownership in the service. Room codes
are returned only to match participants and admins. Socket.IO authenticates
the JWT, creates user rooms from the verified database account, and grants the
admin room only to current admins. Blocking, deactivating, or demoting a user
disconnects that user's active sockets.

## JWT and environment variables

Configure `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, and `CLIENT_URL` in
`.env`. `MONGO_URI` and `FRONTEND_URL` remain supported as local migration
aliases. In production, the server requires a valid HTTPS `CLIENT_URL` and a
JWT secret of at least 32 characters. Never commit `.env`; the example file
contains no credentials. Cloudinary values are optional until an integration
uses them.

## Rate limiting and HTTP

Helmet sets standard security headers and disables Express's `X-Powered-By`.
JSON and URL-encoded bodies are capped at 1 MiB. API requests are limited to
100 per IP per 15 minutes, authentication to 10 per IP per 15 minutes, and
financial or upload writes to 30 per IP per 15 minutes. Rate limits are
in-memory and therefore apply per process; use a shared store if deploying
multiple application instances.

CORS permits only the configured frontend origin in production. Development
also allows localhost ports 3000 and 5173. Production must terminate HTTPS at
the application or a correctly configured trusted reverse proxy; configure
proxy trust narrowly if TLS is terminated upstream.

## File uploads

Only JPEG, PNG, and WEBP uploads are accepted. Uploads are limited to one
5 MiB image per request. The declared MIME type and filename extension are
checked, then the file's byte signature is verified before storage. Stored
names are generated UUID-based names; the user-supplied filename is never
used as a filesystem path. Private evidence and payment proof endpoints check
ownership or admin rights.

## MongoDB and financial operations

Services validate IDs, explicitly select writable fields, escape bounded
search strings, and enforce pagination limits. Never pass request objects
directly into MongoDB filters or updates. Use an authenticated user ID for
player operations and never accept a client-supplied wallet balance.

Wallet debits, credits, deposits, withdrawals, and match financial state
changes use MongoDB transactions and state checks. Database indexes protect
wallet ownership and duplicate financial processing. A wallet balance cannot
be debited below zero. Existing currency values are numeric and normalized to
two decimal places; before production real-money use, plan a coordinated
migration to integer paise or `Decimal128` rather than mixing representations.

## Errors, logs, and sockets

Responses do not include stack traces or internal 5xx error details. Failures
are logged with a request ID, method, route, status, and redacted diagnostic;
request bodies and credentials are not logged. Socket payloads contain only
the data required by the client and never include tokens or passwords.

No password-reset or OTP endpoint currently exists. If account recovery is
added, require a verified, short-lived OTP or reset token; phone, email, and
date of birth alone are not sufficient proof of account ownership.

## Production checklist

- Set strong, unique secrets and database credentials in the deployment
  secret manager; do not put them in source control.
- Use a MongoDB replica set with authentication, network access controls, and
  encrypted connections.
- Serve HTTPS and configure reverse-proxy trust only for known proxy hops.
- Set `NODE_ENV=production` and the exact HTTPS `CLIENT_URL`.
- Monitor request/error logs without collecting passwords, tokens, or request
  bodies.
- If running multiple backend instances, configure a shared rate-limit store
  and a Socket.IO adapter, and ensure user socket revocation is propagated.
- Exercise backup/restore, payment provider callbacks, and financial
  reconciliation before handling real funds.
- Run `npm audit` during regular dependency maintenance; do not apply
  breaking audit fixes without reviewing their changes.
