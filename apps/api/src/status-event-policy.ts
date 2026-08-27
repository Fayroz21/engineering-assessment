import { canTransition, type ApplicationStatus } from "@assessment/contracts";

export type StatusEventDecision =
  | "ACCEPT"
  | "DUPLICATE"
  | "STALE"
  | "INVALID_TRANSITION";

export interface ApplicationSnapshot {
  status: ApplicationStatus;
  /** Partner timestamp of the newest event we have already accepted. */
  lastEventOccurredAt: Date | null;
}

export interface IncomingStatusEvent {
  status: ApplicationStatus;
  occurredAt: Date;
}

/**
 * Decides what an incoming partner event means, given what we already know.
 *
 * Deliberately pure: no database, no clock, no I/O. Every rule the partner
 * integration depends on is decided here and can be tested exhaustively
 * without a database. `application-service.ts` owns loading and persistence.
 *
 * The order of the checks is load-bearing:
 *
 *  1. DUPLICATE first. A partner retrying an old delivery must be told
 *     "already applied", not "stale" - otherwise a safe retry looks like an
 *     integration error and the partner may escalate or stop retrying.
 *  2. STALE before INVALID_TRANSITION. A late-arriving event is out of order,
 *     which is expected and benign; reporting it as an illegal transition
 *     would point the operator at the wrong problem.
 *  3. Only then is the state machine consulted.
 *
 * Staleness uses `<=`. `lastEventOccurredAt` is the newest accepted event, so
 * an event bearing the identical instant carries no evidence that it is newer,
 * and we refuse to reorder state on it. The production answer is a partner
 * sequence number alongside the timestamp (see DESIGN.md).
 */
export function decideStatusEvent(
  current: ApplicationSnapshot,
  event: IncomingStatusEvent,
  alreadyRecorded: boolean,
): StatusEventDecision {
  if (alreadyRecorded) {
    return "DUPLICATE";
  }

  if (
    current.lastEventOccurredAt !== null &&
    event.occurredAt.getTime() <= current.lastEventOccurredAt.getTime()
  ) {
    return "STALE";
  }

  if (!canTransition(current.status, event.status)) {
    return "INVALID_TRANSITION";
  }

  return "ACCEPT";
}
