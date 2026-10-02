const { roundMoney, addMoney, subtractMoney } = require("../utils/money");

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
  const feePercentage = normalizedPlayer1Amount < 100 ? 20 : 3;
  const platformFee = roundMoney((totalPool * feePercentage) / 100);
  const winnerAmount = subtractMoney(totalPool, platformFee);

  if (platformFee < 0 || winnerAmount < 0) {
    throw new RangeError("Match financial values cannot be negative");
  }

  return { totalPool, feePercentage, platformFee, winnerAmount };
}

module.exports = { calculateMatchFinancials };
