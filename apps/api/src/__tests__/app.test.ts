import { randomUUID } from "node:crypto";
import { prisma } from "@assessment/database";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

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
          id: "application-a",
          status: "IN_REVIEW",
          requestedAmountCents: 100_000_00,
          lastEventOccurredAt: new Date("2026-08-20T09:00:00.000Z"),
          history: {
            create: [
              {
                id: randomUUID(),
                status: "SUBMITTED",
                sourceEventId: "seed-1",
                occurredAt: new Date("2026-08-20T08:00:00.000Z"),
              },
              {
                id: randomUUID(),
                status: "IN_REVIEW",
                sourceEventId: "seed-2",
                occurredAt: new Date("2026-08-20T09:00:00.000Z"),
              },
            ],
          },
        },
      },
    },
  });

  await prisma.customer.create({
    data: {
      id: "customer-b",
      name: "Omar",
      email: "omar@example.test",
      phone: "+201222222222",
      applications: {
        create: {
          id: "application-b",
          status: "SUBMITTED",
          requestedAmountCents: 50_000_00,
        },
      },
    },
  });
}

function get(applicationId: string, customerId?: string) {
  const app = buildApp({ database: prisma, logger: false });
  return app
    .inject({
      method: "GET",
      url: `/v1/applications/${applicationId}`,
      headers: customerId === undefined ? {} : { "x-customer-id": customerId },
    })
    .then(async (response) => {
      await app.close();
      return response;
    });
}

describe("GET /health", () => {
  it("reports readiness", async () => {
    const app = buildApp({ database: prisma, logger: false });
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });
});

describe("GET /v1/applications/:applicationId", () => {
  beforeEach(seed);

  it("returns the caller's own application with history newest first", async () => {
    const response = await get("application-a", "customer-a");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: "application-a",
      status: "IN_REVIEW",
      customer: { id: "customer-a", name: "Amina" },
    });
    expect(
      response.json().history.map((entry: { status: string }) => entry.status),
    ).toEqual(["IN_REVIEW", "SUBMITTED"]);
  });

  it("requires an identity", async () => {
    const response = await get("application-a");

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ outcome: "UNAUTHENTICATED" });
  });

  // One customer must never read another's application (README.md:19).
  it("does not return another customer's application", async () => {
    const response = await get("application-b", "customer-a");

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("Omar");
    expect(response.body).not.toContain("omar@example.test");
  });

  // A different response for "exists but not yours" would let a caller
  // enumerate valid application identifiers (DOMAIN.md:37).
  it("is indistinguishable from a missing application", async () => {
    const forbidden = await get("application-b", "customer-a");
    const missing = await get("application-does-not-exist", "customer-a");

    expect(forbidden.statusCode).toBe(missing.statusCode);
    expect(forbidden.json()).toEqual(missing.json());
  });
});
