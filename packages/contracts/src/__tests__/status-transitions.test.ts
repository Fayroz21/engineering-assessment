import { describe, expect, it } from "vitest";
import {
  allowedTransitionsFrom,
  APPLICATION_STATUSES,
  canTransition,
  isTerminal,
  type ApplicationStatus,
} from "../index.js";

/**
 * The lifecycle exactly as drawn in docs/DOMAIN.md. Asserted as a full 6x6
 * matrix so that widening the policy - for example allowing OFFERED -> DECLINED
 * - cannot happen by accident.
 */
const EXPECTED: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  SUBMITTED: ["IN_REVIEW", "DECLINED"],
  IN_REVIEW: ["OFFERED", "DECLINED"],
  OFFERED: ["APPROVED"],
  APPROVED: ["DISBURSED"],
  DECLINED: [],
  DISBURSED: [],
};

describe("status transitions", () => {
  it.each(APPLICATION_STATUSES)("matches the documented edges from %s", (from) => {
    for (const to of APPLICATION_STATUSES) {
      expect(canTransition(from, to)).toBe(EXPECTED[from].includes(to));
    }
  });

  it("treats DECLINED and DISBURSED as terminal and nothing else", () => {
    const terminal = APPLICATION_STATUSES.filter(isTerminal);
    expect(terminal).toEqual(["DECLINED", "DISBURSED"]);
  });

  it("never allows a status to transition to itself", () => {
    for (const status of APPLICATION_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("exposes the same edges it enforces", () => {
    for (const from of APPLICATION_STATUSES) {
      expect([...allowedTransitionsFrom(from)]).toEqual([...EXPECTED[from]]);
    }
  });
});
