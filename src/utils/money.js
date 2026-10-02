function toCents(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new TypeError("Money amount must be a finite number");
  }

  const cents = Math.round((amount + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("Money amount is outside the supported range");
  }

  return cents;
}

function roundMoney(amount) {
  return toCents(amount) / 100;
}

function addMoney(firstAmount, secondAmount) {
  const cents = toCents(firstAmount) + toCents(secondAmount);
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("Money amount is outside the supported range");
  }

  return cents / 100;
}

function subtractMoney(firstAmount, secondAmount) {
  const cents = toCents(firstAmount) - toCents(secondAmount);
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("Money amount is outside the supported range");
  }

  return cents / 100;
}

module.exports = { roundMoney, addMoney, subtractMoney };
