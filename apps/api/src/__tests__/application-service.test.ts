import { randomUUID } from "node:crypto";
import { prisma } from "@assessment/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import {
  getApplicationById,
  getApplicationForCustomer,
  recordStatusEvent,
} from "../application-service.js";

const APPLICATION_ID = "application-a";
const EVENT = {
  eventId: "e1",
  status: "IN_REVIEW",
  occurredAt: "2026-08-20T09:00:00.000Z",
} as const;

async function seed() {
  await prisma.notificationJob.deleteMany();
  await prisma.applicationStatusHistory.deleteMany();
  await prisma.loanApplication.deleteMany();
  await prisma.customer.deleteMany();

  await prisma.customer.create({
    data: {
      id: "customer-a",
      name: "Amina",
      email: "amina@example.test",
      phone: "+201111111111",
      applications: {
        create: {
          id: APPLICATION_ID,
          status: "SUBMITTED",
          requestedAmountCents: 100_000_00,
          lastEventOccurredAt: new Date("2026-08-20T08:00:00.000Z"),
          history: {
            create: {
              id: randomUUID(),
              status: "SUBMITTED",
              sourceEventId: "seed-1",
              occurredAt: new Date("2026-08-20T08:00:00.000Z"),
            },
          },
        },
      },
    },
  });
}

describe("reads", () => {
  beforeEach(seed);

  it.each([
    ["an unknown application", "application-missing"],
    ["an application id that is empty", ""],
  ])("returns null for %s", async (_label, applicationId) => {
    await expect(getApplicationById(prisma, applicationId)).resolves.toBeNull();
  });

  it("returns null when the application belongs to somebody else", async () => {
    await expect(
      getApplicationForCustomer(prisma, APPLICATION_ID, "customer-b"),
    ).resolves.toBeNull();
  });

  it("projects the stored row onto the wire shape", async () => {
    const view = await getApplicationForCustomer(
      prisma,
      APPLICATION_ID,
      "customer-a",
    );

    expect(view).toMatchObject({
      id: APPLICATION_ID,
      status: "SUBMITTED",
      currency: "EGP",
      customer: { id: "customer-a", email: "amina@example.test" },
    });
    // Dates cross the wire as ISO strings, not Date instances.
    expect(typeof view?.createdAt).toBe("string");
    expect(view?.history[0]?.reason).toBeNull();
  });
});

describe("recordStatusEvent error handling", () => {
  beforeEach(seed);

  it("returns NOT_FOUND for an unknown application", async () => {
    const result = await recordStatusEvent(prisma, "application-missing", EVENT);

    expect(result).toEqual({ outcome: "NOT_FOUND" });
  });

  // Only a unique-constraint collision means "already applied". Anything else
  // is a genuine failure and must surface as a 500, not a quiet success.
  it("rethrows a failure that is not a unique-constraint collision", async () => {
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
      new Error("database is unavailable"),
    );

    await expect(
      recordStatusEvent(prisma, APPLICATION_ID, EVENT),
    ).rejects.toThrow("database is unavailable");
  });

  it("reports a collision as DUPLICATE and returns current state", async () => {
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
      Object.assign(new Error("unique constraint failed"), { code: "P2002" }),
    );

    const result = await recordStatusEvent(prisma, APPLICATION_ID, EVENT);

    expect(result.outcome).toBe("DUPLICATE");
  });

  it("reports a collision on a vanished application as NOT_FOUND", async () => {
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
      Object.assign(new Error("unique constraint failed"), { code: "P2002" }),
    );

    const result = await recordStatusEvent(prisma, "application-missing", EVENT);

    expect(result).toEqual({ outcome: "NOT_FOUND" });
  });
});

describe("buildApp defaults", () => {
  it("falls back to the shared client and to logging when unconfigured", async () => {
    // Exercises the option defaults; the shared client points at the same
    // test database, so this is safe to call.
    const app = buildApp({ logger: false });
    const withDefaultLogger = buildApp({ database: prisma });

    await expect(
      app.inject({ method: "GET", url: "/health" }),
    ).resolves.toMatchObject({ statusCode: 200 });

    await app.close();
    await withDefaultLogger.close();
  });
});
