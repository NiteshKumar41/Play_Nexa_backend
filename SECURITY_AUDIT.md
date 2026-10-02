# Play Nexa Backend Security Audit

Scope: the backend source, API routes, models, middleware, Socket.IO handlers,
environment templates, and dependency manifest reviewed for Checkpoint 13.

| Issue | Risk | Current implementation | Recommended fix | Status |
| --- | --- | --- | --- | --- |
| Non-participants could retrieve a joined match room code | A logged-in player who knows a match ID could enter a private game room | Match detail responses included `roomCode` for every authenticated caller; screenshot evidence was already limited to participants/admins | Only return the room code to match participants and admins | Fixed in Checkpoint 13 |
| No API request rate limits | Login guessing and repeated resource-intensive writes could be automated | No Express rate-limiter middleware was configured | Apply a general API limit plus stricter authentication and financial-write limits | Fixed in Checkpoint 13 |
| No standard HTTP security-header middleware or explicit request-body cap | Weaker browser-facing defaults and unnecessary memory exposure to large JSON requests | Express configured JSON parsing without an explicit limit; Helmet was not configured | Add Helmet and bounded JSON/URL-encoded parsing | Fixed in Checkpoint 13 |
| JWT startup/configuration checks were incomplete | A missing or malformed production token configuration could make startup fail only when a token is generated | JWT secret was read lazily; token expiry had a code fallback; database configuration used `MONGO_URI` | Validate required deployment variables at startup and use the configured JWT expiry | Fixed in Checkpoint 13 |
| CORS used one environment value without explicit environment policy | A misconfigured production URL could allow an unintended frontend origin | Express and Socket.IO used `FRONTEND_URL`, with a localhost fallback | Require an explicit production frontend origin and restrict development origins to localhost/configured origin | Fixed in Checkpoint 13 |
| Upload middleware checked declared MIME/extension before content validation | Those headers are client-controlled, although persisted images were additionally signature-checked | Memory uploads were capped at 5 MiB and services checked image signatures before saving under generated names | Share upload limits/types and retain byte-signature validation before persistence | Hardened in Checkpoint 13 |
| Internal errors were not consistently logged, while request context was absent | Unexpected failures could be hard to diagnose; careless logging could expose request data | 5xx responses were generic, while the error middleware did not log a safe diagnostic | Log a request ID, route, status, and error category without request bodies or secrets; keep client errors generic | Fixed in Checkpoint 13 |
| Password reset/OTP support is absent | No insecure recovery flow was found, but account recovery is not available | Authentication provides signup, login, and current-user endpoints | Add recovery only with a verified OTP/token workflow; do not use profile details alone | No vulnerable implementation found |
| Money uses numeric amounts with two-decimal normalization | Floating-point persistence remains a financial precision concern | Existing financial services normalize calculations through integer cents, with MongoDB transactions and state checks | Keep this system consistent; plan a coordinated integer-paise/Decimal128 migration before handling production money | Documented residual risk |
| In-memory rate limits do not coordinate across multiple backend instances | Limits can be multiplied across replicas or reset on restart | The application runs as a single Express/Socket.IO process | Use a shared store only if deploying multiple instances; no Redis is introduced in this checkpoint | Documented deployment limitation |

Existing controls verified during the audit include bcrypt password hashing,
database-backed active/blocked/admin checks, authenticated Socket.IO rooms,
participant-only result evidence access, explicit service input allowlists,
bounded paginated lists, escaped bounded searches, image content signatures,
generated upload names, atomic wallet/match transactions, duplicate-processing
database indexes, and a partial unique index limiting active payment methods.
