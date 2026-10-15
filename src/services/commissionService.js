const PlatformCommission = require("../models/PlatformCommission");
const { roundMoney, subtractMoney } = require("../utils/money");

const REFERRAL_REWARD_RATE = 2;

function commissionRateForEntry(entryAmount) {
  const normalizedEntryAmount = roundMoney(entryAmount);

  // Entries below ₹10 remain valid, but have no new platform commission.
  if (normalizedEntryAmount < 10) return 0;
  if (normalizedEntryAmount <= 20) return 1.5;
  if (normalizedEntryAmount <= 40) return 2;
  if (normalizedEntryAmount <= 60) return 3;
  if (normalizedEntryAmount <= 80) return 4;
  if (normalizedEntryAmount <= 100) return 5;
  return 4;
}

function calculateCommission({ entryAmount, grossWinningAmount }) {
  const normalizedEntryAmount = roundMoney(entryAmount);
  const normalizedGrossWinningAmount = roundMoney(grossWinningAmount);
  if (normalizedEntryAmount <= 0 || normalizedGrossWinningAmount <= 0) {
    throw new RangeError("Commission inputs must be greater than 0");
  }

  const commissionRate = commissionRateForEntry(normalizedEntryAmount);
  const commissionAmount = roundMoney(
    (normalizedGrossWinningAmount * commissionRate) / 100
  );

  return {
    entryAmount: normalizedEntryAmount,
    grossWinningAmount: normalizedGrossWinningAmount,
    commissionRate,
    commissionAmount,
  };
}

function calculateSettlementFinancials({
  entryAmount,
  grossWinningAmount,
  hasEligibleReferrer = false,
}) {
  const commission = calculateCommission({ entryAmount, grossWinningAmount });
  const referralReward = hasEligibleReferrer && commission.grossWinningAmount > 100
    ? roundMoney(
        (commission.grossWinningAmount * REFERRAL_REWARD_RATE) / 100
      )
    : 0;
  const winnerNetPayout = subtractMoney(
    subtractMoney(commission.grossWinningAmount, commission.commissionAmount),
    referralReward
  );

  if (winnerNetPayout < 0) {
    throw new RangeError("Settlement payout cannot be negative");
  }

  return {
    ...commission,
    referralRewardRate: referralReward > 0 ? REFERRAL_REWARD_RATE : 0,
    referralReward,
    winnerNetPayout,
  };
}

async function recordPlatformCommission({
  matchId,
  entryAmount,
  grossWinningAmount,
  commissionRate,
  commissionAmount,
  settlementReference,
  session,
}) {
  if (!session) throw new Error("A MongoDB session is required");

  const [commission] = await PlatformCommission.create(
    [
      {
        matchId,
        entryAmount: roundMoney(entryAmount),
        grossWinningAmount: roundMoney(grossWinningAmount),
        commissionRate,
        commissionAmount: roundMoney(commissionAmount),
        settlementReference,
      },
    ],
    { session }
  );

  return commission;
}

module.exports = {
  REFERRAL_REWARD_RATE,
  commissionRateForEntry,
  calculateCommission,
  calculateSettlementFinancials,
  recordPlatformCommission,
};
