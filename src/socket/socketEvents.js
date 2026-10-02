const SOCKET_EVENTS = {
  MATCH_CREATED: "match_created",
  MATCH_JOINED: "match_joined",
  MATCH_UPDATED: "match_updated",
  MATCH_CANCELLED: "match_cancelled",
  MATCH_PLAYER_LEFT: "match_player_left",
  ROOM_CODE_UPDATED: "room_code_updated",
  RESULT_SUBMITTED: "result_submitted",
  DISPUTE_SUBMITTED: "dispute_submitted",
  MATCH_RESULT_UPDATED: "match_result_updated",
  MATCH_SETTLED: "match_settled",
  MATCH_REFUNDED: "match_refunded",
  MATCH_CLAIM_REJECTED: "match_claim_rejected",
  DEPOSIT_APPROVED: "deposit_approved",
  DEPOSIT_REJECTED: "deposit_rejected",
  WITHDRAWAL_SUCCESS: "withdrawal_success",
  WITHDRAWAL_FAILED: "withdrawal_failed",
  SUPPORT_TICKET_CREATED: "support_ticket_created",
  SUPPORT_TICKET_UPDATED: "support_ticket_updated",
  SUPPORT_TICKET_RESOLVED: "support_ticket_resolved",
  SOCKET_ERROR: "socket_error",
};

module.exports = { SOCKET_EVENTS };
