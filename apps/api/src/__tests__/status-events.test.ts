import { randomUUID } from "node:crypto";
import { prisma } from "@assessment/database";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const APPLICATION_ID = "application-a";
const T0 = "2026-08-20T08:00:00.000Z";
const T1 = "2026-08-20T09:00:00.000Z";
const T2 = "2026-08-20T10:00:00.000Z";

async function seed(status = "SUBMITTED", lastEventOccurredAt = T0) {
  await prisma.notificationJob.deleteMany();
  await prisma.applicationStatusHistory.deleteMany();
  await prisma.loanApplication.deleteMany();
  await prisma.customer.deleteMany();

  await prisma.customer.create({
    data: {
      id: "customer-a",
      name: "Test Customer",
      email: "customer@example.test",
      phone: "+201111111111",
      applications: {
        create: {
          id: APPLICATION_ID,
          status,
          requestedAmountCents: 100_000_00,
          lastEventOccurredAt: new Date(lastEventOccurredAt),
          history: {
            create: {
              id: randomUUID(),
              status,
              sourceEventId: "initial-event",
              occurredAt: new Date(lastEventOccurredAt),
            },
          },
        },
      },
    },
  });
}

function post(
  app: ReturnType<typeof buildApp>,
  payload: Record<string, unknown>,
  applicationId = APPLICATION_ID,
) {
  return app.inject({
    method: "POST",
    url: `/v1/applications/${applicationId}/status-events`,
    payload,
  });
}

/** Rows written by partner events, excluding the seeded initial entry. */
async function counts() {
  const [history, jobs] = await Promise.all([
    prisma.applicationStatusHistory.count({
      where: { sourceEventId: { not: "initial-event" } },
    }),
    prisma.notificationJob.count(),
  ]);
  return { history, jobs };
}

async function currentApplication() {
  return prisma.loanApplication.findUniqueOrThrow({
    where: { id: APPLICATION_ID },
  });
}

describe("partner status events", () => {
  beforeEach(() => seed());

  describe("an accepted event", () => {
    it("records history, advances state, and queues exactly one notification", async () => {
      const app = buildApp({ database: prisma, logger: false });
      const response = await post(app, {
        eventId: "e1",
        status: "IN_REVIEW",
        occurredAt: T1,
        reason: "Documents received",
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({
        outcome: "ACCEPTED",
        application: { status: "IN_REVIEW" },
      });

      expect(await counts()).toEqual({ history: 1, jobs: 1 });

      const application = await currentApplication();
      expect(application.status).toBe("IN_REVIEW");
      expect(application.lastEventOccurredAt?.toISOString()).toBe(T1);
      await app.close();
    });
  });

  describe("duplicate delivery", () => {
    it("is idempotent when the partner retries the same eventId", async () => {
      const app = buildApp({ database: prisma, logger: false });
      const event = { eventId: "e1", status: "IN_REVIEW", occurredAt: T1 };

      const first = await post(app, event);
      const second = await post(app, event);

      expect(first.statusCode).toBe(202);
      // 200, not 409: the effect the partner wanted is in place, so the retry
      // succeeded. They should stop retrying rather than escalate.
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ outcome: "DUPLICATE" });

      expect(await counts()).toEqual({ history: 1, jobs: 1 });
      await app.close();
    });

    // The read-then-write check cannot cover this; the unique index can.
    it("applies a concurrently delivered eventId exactly once", async () => {
      const app = buildApp({ database: prisma, logger: false });
      const event = { eventId: "e1", status: "IN_REVIEW", occurredAt: T1 };

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => post(app, event)),
      );

      // Any mix of 202/200 is acceptable under contention; what must hold is
      // that the event had exactly one effect.
      expect(
        responses.every((response) => [200, 202].includes(response.statusCode)),
      ).toBe(true);
      expect(await counts()).toEqual({ history: 1, jobs: 1 });
      await app.close();
    });

    it("reports a replayed event as duplicate even once it is stale", async () => {
      const app = buildApp({ database: prisma, logger: false });
      await post(app, { eventId: "e1", status: "IN_REVIEW", occurredAt: T1 });
      await post(app, { eventId: "e2", status: "OFFERED", occurredAt: T2 });

      const replay = await post(app, {
        eventId: "e1",
        status: "IN_REVIEW",
        occurredAt: T1,
      });

      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ outcome: "DUPLICATE" });
      expect((await currentApplication()).status).toBe("OFFERED");
      await app.close();
    });
  });

  describe("out-of-order delivery", () => {
    it("refuses to roll state backwards", async () => {
      const app = buildApp({ database: prisma, logger: false });
      await post(app, { eventId: "e2", status: "IN_REVIEW", occurredAt: T2 });

      const stale = await post(app, {
        eventId: "e1",
        status: "DECLINED",
        occurredAt: T1,
      });

      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ outcome: "STALE" });

      const application = await currentApplication();
      expect(application.status).toBe("IN_REVIEW");
      expect(application.lastEventOccurredAt?.toISOString()).toBe(T2);
      expect(await counts()).toEqual({ history: 1, jobs: 1 });
      await app.close();
    });
  });

  describe("invalid state changes", () => {
    it("rejects a transition the lifecycle does not allow", async () => {
      const app = buildApp({ database: prisma, logger: false });
      const response = await post(app, {
        eventId: "e1",
        status: "DISBURSED",
        occurredAt: T1,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        outcome: "INVALID_TRANSITION",
        from: "SUBMITTED",
        to: "DISBURSED",
      });
      expect(await counts()).toEqual({ history: 0, jobs: 0 });
      expect((await currentApplication()).status).toBe("SUBMITTED");
      await app.close();
    });

    it("locks an application in a terminal state", async () => {
      await seed("DISBURSED", T1);
      const app = buildApp({ database: prisma, logger: false });

      const response = await post(app, {
        eventId: "e1",
        status: "DECLINED",
        occurredAt: T2,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ outcome: "INVALID_TRANSITION" });
      expect(await counts()).toEqual({ history: 0, jobs: 0 });
      await app.close();
    });
  });

  describe("rejected requests", () => {
    it("returns 404 for an unknown application without writing anything", async () => {
      const app = buildApp({ database: prisma, logger: false });
      const response = await post(
        app,
        { eventId: "e1", status: "IN_REVIEW", occurredAt: T1 },
        "application-missing",
      );

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ outcome: "NOT_FOUND" });
      expect(await counts()).toEqual({ history: 0, jobs: 0 });
      await app.close();
    });

    it.each([
      ["an empty eventId", { eventId: "", status: "IN_REVIEW", occurredAt: T1 }],
      ["an unknown status", { eventId: "e1", status: "UNKNOWN", occurredAt: T1 }],
      ["a non-ISO timestamp", { eventId: "e1", status: "IN_REVIEW", occurredAt: "yesterday" }],
      ["an unknown field", { eventId: "e1", status: "IN_REVIEW", occurredAt: T1, staus: "x" }],
      ["a far-future timestamp", { eventId: "e1", status: "IN_REVIEW", occurredAt: "3000-01-01T00:00:00.000Z" }],
    ])("returns 400 for %s", async (_label, payload) => {
      const app = buildApp({ database: prisma, logger: false });
      const response = await post(app, payload);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ outcome: "INVALID_REQUEST" });
      expect(await counts()).toEqual({ history: 0, jobs: 0 });
      await app.close();
    });
  });

  describe("atomicity", () => {
    // State, evidence and the notification request are one logical change
    // (DOMAIN.md:19): if the notification write fails, none of it may persist.
    it("rolls back the status change when the notification write fails", async () => {
      const app = buildApp({ database: prisma, logger: false });

      // Occupy the notification job's unique key so the third write collides.
      await prisma.notificationJob.create({
        data: {
          id: randomUUID(),
          applicationId: APPLICATION_ID,
          sourceEventId: "e1",
          type: "APPLICATION_STATUS_CHANGED",
          payload: JSON.stringify({ status: "IN_REVIEW" }),
        },
      });

      const response = await post(app, {
        eventId: "e1",
        status: "IN_REVIEW",
        occurredAt: T1,
      });

      // The collision is indistinguishable from a duplicate delivery, which is
      // the safe reading: no second effect was applied.
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ outcome: "DUPLICATE" });

      const application = await currentApplication();
      expect(application.status).toBe("SUBMITTED");
      expect(application.lastEventOccurredAt?.toISOString()).toBe(T0);
      expect(await counts()).toEqual({ history: 0, jobs: 1 });
      await app.close();
    });
  });
});
