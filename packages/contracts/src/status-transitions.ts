import type { ApplicationStatus } from "./index.js";

/**
 * The lifecycle documented in docs/DOMAIN.md:
 *
 *   SUBMITTED -> IN_REVIEW -> OFFERED -> APPROVED -> DISBURSED
 *                           \-> DECLINED
 *                 \---------------------> DECLINED
 *
 * Encoded exactly as drawn. `DECLINED` is intentionally NOT reachable from
 * `OFFERED` or `APPROVED`: the diagram does not show those edges. See ISSUES.md
 * for the open question. Widening the policy means editing this table only.
 */
const ALLOWED_TRANSITIONS: Record<
  ApplicationStatus,
  readonly ApplicationStatus[]
> = {
  SUBMITTED: ["IN_REVIEW", "DECLINED"],
  IN_REVIEW: ["OFFERED", "DECLINED"],
  OFFERED: ["APPROVED"],
  APPROVED: ["DISBURSED"],
  DECLINED: [],
  DISBURSED: [],
} as const;

/** A status no event may ever move away from. */
export function isTerminal(status: ApplicationStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/**
 * Self-transitions are rejected: re-announcing the current status is not a
 * state change, and accepting one would add a history entry and a customer
 * notification for an event that changed nothing.
 */
export function canTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Exposed for tests and for documenting the policy. */
export function allowedTransitionsFrom(
  from: ApplicationStatus,
): readonly ApplicationStatus[] {
  return ALLOWED_TRANSITIONS[from];
}
