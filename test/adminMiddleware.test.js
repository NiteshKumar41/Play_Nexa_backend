const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const adminMiddleware = require("../src/middleware/adminMiddleware");

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe("adminMiddleware role enforcement (no database)", () => {
  it("rejects a player even when the request is authenticated", () => {
    const response = createResponse();
    let nextCalled = false;

    adminMiddleware(
      { user: { id: "player-1", role: "player" } },
      response,
      () => { nextCalled = true; }
    );

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.message, "Admin access is required");
    assert.equal(nextCalled, false);
  });

  it("allows only the server-provided admin role", () => {
    const response = createResponse();
    let nextCalled = false;

    adminMiddleware(
      { user: { id: "admin-1", role: "admin" } },
      response,
      () => { nextCalled = true; }
    );

    assert.equal(nextCalled, true);
    assert.equal(response.statusCode, null);
  });
});
