const { roundMoney, addMoney, subtractMoney } = require("../utils/money");
const { calculateCommission } = require("./commissionService");

function calculateMatchFinancials(player1Amount, player2Amount) {
  const normalizedPlayer1Amount = roundMoney(player1Amount);
  const normalizedPlayer2Amount = roundMoney(player2Amount);

  if (normalizedPlayer1Amount <= 0 || normalizedPlayer2Amount <= 0) {
    throw new RangeError("Player entry amounts must be greater than 0");
  }

  const totalPool = addMoney(
    normalizedPlayer1Amount,
    normalizedPlayer2Amount
  );
  const commission = calculateCommission({
    entryAmount: normalizedPlayer1Amount,
    grossWinningAmount: totalPool,
  });
  const feePercentage = commission.commissionRate;
  const platformFee = commission.commissionAmount;
  const winnerAmount = subtractMoney(totalPool, platformFee);

  if (platformFee < 0 || winnerAmount < 0) {
    throw new RangeError("Match financial values cannot be negative");
  }

  return {
    totalPool,
    feePercentage,
    commissionRate: commission.commissionRate,
    platformFee,
    platformCommission: commission.commissionAmount,
    grossWinningAmount: totalPool,
    estimatedWinnerPayout: winnerAmount,
    // Legacy calculation aliases are retained for callers that use this
    // helper before settlement. SettlementService is authoritative for the
    // final winnerNetPayout.
    winnerAmount,
    winnerNetPayout: winnerAmount,
  };
}

module.exports = { calculateMatchFinancials };
