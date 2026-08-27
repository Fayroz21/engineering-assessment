import { APPLICATION_STATUSES, type ApplicationStatus } from "@assessment/contracts";
import { describe, expect, it } from "vitest";
import {
  decideStatusEvent,
  type ApplicationSnapshot,
} from "../status-event-policy.js";

const T0 = new Date("2026-08-20T08:00:00.000Z");
const T1 = new Date("2026-08-20T09:00:00.000Z");

function snapshot(
  status: ApplicationStatus,
  lastEventOccurredAt: Date | null = T0,
): ApplicationSnapshot {
  return { status, lastEventOccurredAt };
}

describe("decideStatusEvent", () => {
  describe("accepts", () => {
    it("a legal transition that is newer than the last accepted event", () => {
      expect(
        decideStatusEvent(
          snapshot("SUBMITTED"),
          { status: "IN_REVIEW", occurredAt: T1 },
          false,
        ),
      ).toBe("ACCEPT");
    });

    it("the first event, when no event has been accepted yet", () => {
      expect(
        decideStatusEvent(
          snapshot("SUBMITTED", null),
          { status: "IN_REVIEW", occurredAt: new Date(0) },
          false,
        ),
      ).toBe("ACCEPT");
    });
  });

  describe("duplicates", () => {
    it("reports an already-recorded event as DUPLICATE", () => {
      expect(
        decideStatusEvent(
          snapshot("IN_REVIEW"),
          { status: "IN_REVIEW", occurredAt: T1 },
          true,
        ),
      ).toBe("DUPLICATE");
    });

    // The partner retrying an old delivery must be told "already applied", not
    // "stale" - a safe retry should never look like an integration error.
    it("takes precedence over staleness", () => {
      expect(
        decideStatusEvent(
          snapshot("OFFERED", T1),
          { status: "IN_REVIEW", occurredAt: T0 },
          true,
        ),
      ).toBe("DUPLICATE");
    });

    it("takes precedence over an illegal transition", () => {
      expect(
        decideStatusEvent(
          snapshot("DISBURSED"),
          { status: "SUBMITTED", occurredAt: T1 },
          true,
        ),
      ).toBe("DUPLICATE");
    });
  });

  describe("ordering", () => {
    it("rejects an event older than the last accepted one", () => {
      expect(
        decideStatusEvent(
          snapshot("IN_REVIEW", T1),
          { status: "OFFERED", occurredAt: T0 },
          false,
        ),
      ).toBe("STALE");
    });

    // An event bearing the identical instant carries no evidence it is newer.
    it("rejects an event bearing the same instant as the last accepted one", () => {
      expect(
        decideStatusEvent(
          snapshot("IN_REVIEW", T1),
          { status: "OFFERED", occurredAt: new Date(T1) },
          false,
        ),
      ).toBe("STALE");
    });

    it("checks staleness before the state machine", () => {
      expect(
        decideStatusEvent(
          snapshot("SUBMITTED", T1),
          { status: "DISBURSED", occurredAt: T0 },
          false,
        ),
      ).toBe("STALE");
    });
  });

  describe("state machine", () => {
    it.each([
      ["SUBMITTED", "OFFERED"],
      ["SUBMITTED", "APPROVED"],
      ["SUBMITTED", "DISBURSED"],
      ["IN_REVIEW", "APPROVED"],
      ["IN_REVIEW", "DISBURSED"],
      ["OFFERED", "DECLINED"],
      ["APPROVED", "DECLINED"],
      ["APPROVED", "IN_REVIEW"],
    ] as const)("rejects %s -> %s", (from, to) => {
      expect(
        decideStatusEvent(snapshot(from), { status: to, occurredAt: T1 }, false),
      ).toBe("INVALID_TRANSITION");
    });

    it.each(["DECLINED", "DISBURSED"] as const)(
      "locks the terminal state %s against every other status",
      (terminal) => {
        for (const next of APPLICATION_STATUSES) {
          expect(
            decideStatusEvent(
              snapshot(terminal),
              { status: next, occurredAt: T1 },
              false,
            ),
          ).toBe("INVALID_TRANSITION");
        }
      },
    );

    it.each(APPLICATION_STATUSES)(
      "rejects %s re-announcing itself",
      (status) => {
        expect(
          decideStatusEvent(
            snapshot(status),
            { status, occurredAt: T1 },
            false,
          ),
        ).toBe("INVALID_TRANSITION");
      },
    );
  });
});
