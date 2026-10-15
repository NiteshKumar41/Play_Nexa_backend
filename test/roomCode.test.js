const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { validateRoomCode } = require("../src/services/matchService");

describe("room code validation (no database)", () => {
  it("trims printable room codes without imposing an unverified vendor format", () => {
    assert.equal(validateRoomCode("  ROOM-123  "), "ROOM-123");
    assert.equal(validateRoomCode("123 456"), "123 456");
  });

  it("rejects empty, overlong, and control-character values", () => {
    for (const value of ["", "   ", "ROOM\n123"]) {
      assert.throws(
        () => validateRoomCode(value),
        error => error.statusCode === 400
      );
    }

    assert.throws(
      () => validateRoomCode("R".repeat(65)),
      error => error.statusCode === 400
    );
  });
});
