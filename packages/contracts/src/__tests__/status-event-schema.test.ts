import { describe, expect, it } from "vitest";
import { MAX_CLOCK_SKEW_MS, statusEventSchema } from "../index.js";

const valid = {
  eventId: "partner-event-100",
  status: "IN_REVIEW",
  occurredAt: "2026-08-20T10:30:00.000Z",
  reason: "Documents received",
};

function firstIssuePath(input: unknown): string | undefined {
  const result = statusEventSchema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.path.join(".");
}

describe("statusEventSchema", () => {
  it("accepts a well-formed event", () => {
    expect(statusEventSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts an event without the optional reason", () => {
    const withoutReason = {
      eventId: valid.eventId,
      status: valid.status,
      occurredAt: valid.occurredAt,
    };
    expect(statusEventSchema.safeParse(withoutReason).success).toBe(true);
  });

  it("trims the event identifier", () => {
    const parsed = statusEventSchema.parse({ ...valid, eventId: "  e1  " });
    expect(parsed.eventId).toBe("e1");
  });

  it.each([
    ["an empty eventId", { ...valid, eventId: "" }, "eventId"],
    ["an oversized eventId", { ...valid, eventId: "x".repeat(101) }, "eventId"],
    ["an unknown status", { ...valid, status: "UNKNOWN" }, "status"],
    ["a non-ISO timestamp", { ...valid, occurredAt: "yesterday" }, "occurredAt"],
    ["a timestamp without a zone", { ...valid, occurredAt: "2026-08-20T10:30:00" }, "occurredAt"],
    ["an oversized reason", { ...valid, reason: "x".repeat(501) }, "reason"],
  ])("rejects %s", (_label, input, path) => {
    expect(firstIssuePath(input)).toBe(path);
  });

  // A partner typo should surface as a 400, not be silently dropped.
  it("rejects unknown fields", () => {
    const result = statusEventSchema.safeParse({ ...valid, staus: "IN_REVIEW" });
    expect(result.success).toBe(false);
  });

  describe("clock skew bound", () => {
    // Without this bound one bad timestamp poisons lastEventOccurredAt and
    // every later event is rejected as stale, permanently.
    it("rejects a timestamp far in the future", () => {
      const far = new Date(Date.now() + MAX_CLOCK_SKEW_MS * 2).toISOString();
      expect(firstIssuePath({ ...valid, occurredAt: far })).toBe("occurredAt");
    });

    it("tolerates ordinary clock skew", () => {
      const slightly = new Date(Date.now() + 60_000).toISOString();
      const result = statusEventSchema.safeParse({ ...valid, occurredAt: slightly });
      expect(result.success).toBe(true);
    });
  });
});
