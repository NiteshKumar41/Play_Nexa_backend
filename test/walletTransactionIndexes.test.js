const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const WalletTransaction = require("../src/models/WalletTransaction");

describe("WalletTransaction settlement index semantics", () => {
  it("keeps GAME_WIN, WITHDRAW_REFUND, and MATCH_REFUND indexes distinct and scoped", () => {
    const indexes = WalletTransaction.schema.indexes();
    const findIndex = name => indexes.find(([, options]) => options?.name === name);

    assert.ok(
      WalletTransaction.schema.path("referenceType").enumValues.includes("MATCH")
    );

    const gameWin = findIndex("walletTransaction_gameWin_matchSettlement_unique");
    const withdrawRefund = findIndex(
      "walletTransaction_withdrawRefund_withdrawal_unique"
    );
    const matchRefund = indexes.find(([keys, options]) =>
      options?.unique &&
      keys.userId === 1 &&
      keys.transactionType === 1 &&
      keys.referenceType === 1 &&
      keys.referenceId === 1 &&
      options.partialFilterExpression?.transactionType === "GAME_REFUND" &&
      options.partialFilterExpression?.referenceType === "MATCH_REFUND" &&
      options.partialFilterExpression?.status === "SUCCESS"
    );

    assert.ok(gameWin);
    assert.ok(withdrawRefund);
    assert.ok(matchRefund);
    assert.deepEqual(gameWin[0], {
      transactionType: 1,
      referenceType: 1,
      referenceId: 1,
    });
    assert.deepEqual(withdrawRefund[0], {
      transactionType: 1,
      referenceType: 1,
      referenceId: 1,
    });
    assert.equal(
      gameWin[1].partialFilterExpression.transactionType,
      "GAME_WIN"
    );
    assert.equal(
      withdrawRefund[1].partialFilterExpression.transactionType,
      "WITHDRAW_REFUND"
    );

    const addMoney = findIndex("walletTransaction_addMoney_clientRequest_unique");
    const withdraw = findIndex("walletTransaction_withdraw_clientRequest_unique");
    const addMoneyRefund = findIndex(
      "walletTransaction_addMoneyRefund_providerRefund_unique"
    );
    const addMoneyUpi = findIndex("walletTransaction_addMoney_upiTransaction_unique");
    const uniqueIndexes = indexes.filter(([, options]) => options?.unique);
    const uniqueNames = uniqueIndexes.map(([, options]) => options.name);

    assert.ok(addMoney);
    assert.ok(withdraw);
    assert.ok(addMoneyRefund);
    assert.ok(addMoneyUpi);
    assert.equal(uniqueNames.every(Boolean), true);
    assert.equal(new Set(uniqueNames).size, uniqueNames.length);
    assert.equal(
      addMoney[1].partialFilterExpression.transactionType,
      "ADD_MONEY"
    );
    assert.equal(
      withdraw[1].partialFilterExpression.transactionType,
      "WITHDRAW"
    );
    assert.equal(
      addMoneyRefund[1].partialFilterExpression.transactionType,
      "ADD_MONEY_REFUND"
    );
    assert.equal(
      addMoneyUpi[1].partialFilterExpression.transactionType,
      "ADD_MONEY"
    );
  });
});
