# Referral and settlement accounting

## New settlement semantics

For settlements created after this change, `prizePool` is the gross winning
amount. The legacy 20%/3% fee calculation is not used for these settlements.

```text
grossWinningAmount = prizePool
platformCommission = round(grossWinningAmount * commissionRate / 100)
referralReward = round(grossWinningAmount * 2 / 100) when grossWinningAmount > 100
winnerNetPayout = grossWinningAmount - platformCommission - referralReward
```

The commission rate is selected from the winner's match entry amount. Entries
below ₹10 use 0%; the configured slabs are implemented in
`src/services/commissionService.js`.

`platformFee` and `winnerAmount` remain in API responses for compatibility.
For new settlements they are aliases for `platformCommission` and
`winnerNetPayout`, respectively. The additive fields are the authoritative
settlement fields.

Before settlement, `estimatedWinnerPayout` may be shown as a qualified estimate
that excludes a possible referral reward. `winnerNetPayout` is zero until the
match is successfully settled and must not be presented as a final payout
before then.

## Accounting model

`PlatformCommission` is a dedicated accounting/audit collection. It stores one
unique record per successfully settled match with the entry amount, gross
winning amount, applied rate, commission amount, and stable settlement
reference. It is written in the same MongoDB transaction as wallet ledger
entries and the match state. It is not a player wallet, does not create a fake
user, and does not represent withdrawable cash; a separate platform cash
collection process would be required for that.

Admin commission totals are sourced from `PlatformCommission`. Historical
matches without a `platformCommissionId` are reported separately as legacy
platform fees and are not included in the new commission total.

Referral rewards use the `REFERRAL_REWARD` wallet transaction type and the
`REFERRAL_REWARD` reference type. Their unique match index prevents a second
reward ledger entry.

## Index and transaction readiness

Index verification and creation are explicitly invoked; application startup
does not migrate production data. Run against a dedicated staging database
first, with the database name pinned:

```sh
MONGODB_URI='<staging-uri>' npm run settlement:indexes:verify -- --database-name=playnexa_staging
SETTLEMENT_INDEX_MIGRATION_CONFIRM=playnexa_staging \
MONGODB_URI='<staging-uri>' \
npm run settlement:indexes:apply -- --database-name=playnexa_staging
```

The apply command performs a read-only transaction capability check, duplicate
preflight, and conflicting-index check before creating only missing indexes. It
never drops indexes or deletes records. Use a MongoDB deployment that supports
transactions (replica set or sharded cluster); URI syntax alone is not proof
of that capability. Production application requires an explicit operational
change procedure and the script's additional `--allow-production` guard.

## Referral relationships

New users receive a server-generated, unique referral code. A signup may store
one `referredBy` user, and that relationship is immutable. Existing users with
no code receive one lazily when they log in or load `/auth/me`; no bulk
migration is run automatically. Existing users without a referrer remain valid
and receive no referral rewards for that reason.

## Historical records and reversals

Existing settled matches and wallet transactions are not rewritten. New
settlements use the new fields and formulas; legacy records retain their
historical values. The current lifecycle has no completed-settlement reversal
operation. If reversal support is added later, it must use compensating ledger
transactions and a corresponding commission/reward reversal record rather than
deleting financial history.
