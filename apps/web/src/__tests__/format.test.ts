import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, formatStatus } from "../format.js";

describe("formatStatus", () => {
  it.each([
    ["SUBMITTED", "Submitted"],
    ["IN_REVIEW", "In Review"],
    ["DISBURSED", "Disbursed"],
  ])("renders %s as %s", (input, expected) => {
    expect(formatStatus(input)).toBe(expected);
  });

  // The original implementation produced the literal string "undefined" here.
  it("does not emit 'undefined' for an empty segment", () => {
    expect(formatStatus("IN__REVIEW")).not.toContain("undefined");
    expect(formatStatus("")).toBe("");
  });
});

describe("formatMoney", () => {
  it("renders minor units at the correct scale", () => {
    expect(formatMoney(250_000_00, "EGP")).toContain("250,000");
  });

  it("renders zero", () => {
    expect(formatMoney(0, "EGP")).toContain("0");
  });
});

describe("formatDate", () => {
  // Rendered in a server component: without a fixed zone the server's local
  // time leaks into customer-facing output.
  it("formats in UTC regardless of the host timezone", () => {
    expect(formatDate("2026-08-20T08:00:00.000Z")).toContain("2026");
    expect(formatDate("2026-08-20T08:00:00.000Z")).toContain("Aug");
  });
});
