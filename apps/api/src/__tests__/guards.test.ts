import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  requireCustomer,
  requirePartner,
  validateBody,
  type BodyValidator,
} from "../guards.js";

/**
 * A hand-rolled validator rather than the real Zod schema: `validateBody`
 * depends only on the `BodyValidator` shape, and this test proves it. The real
 * schema is exercised end to end in status-events.test.ts.
 */
const nameValidator: BodyValidator<{ name: string }> = {
  safeParse(input) {
    const record = (input ?? {}) as Record<string, unknown>;
    const name = record.name;

    if (typeof name !== "string" || name.trim().length === 0) {
      return { success: false, error: { flatten: () => ({ name: "required" }) } };
    }

    if (Object.keys(record).length > 1) {
      return { success: false, error: { flatten: () => ({ name: "unknown keys" }) } };
    }

    return { success: true, data: { name: name.trim() } };
  },
};

function buildGuardHarness() {
  const app = Fastify({ logger: false });
  app.decorateRequest("customerId", "");

  app.get("/scoped", { preHandler: [requireCustomer] }, async (request) => ({
    customerId: request.customerId,
  }));

  app.post(
    "/partner",
    {
      preHandler: [requirePartner, validateBody(nameValidator)],
    },
    async (request) => ({ body: request.body }),
  );

  return app;
}

describe("requireCustomer", () => {
  it.each([
    ["a missing header", {}],
    ["an empty header", { "x-customer-id": "" }],
    ["a whitespace-only header", { "x-customer-id": "   " }],
  ])("rejects %s with 401", async (_label, headers) => {
    const app = buildGuardHarness();
    const response = await app.inject({ method: "GET", url: "/scoped", headers });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ outcome: "UNAUTHENTICATED" });
    await app.close();
  });

  // The handler reads request.customerId and never touches the header itself.
  it("exposes the trimmed identity to the handler", async () => {
    const app = buildGuardHarness();
    const response = await app.inject({
      method: "GET",
      url: "/scoped",
      headers: { "x-customer-id": "  customer-a  " },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ customerId: "customer-a" });
    await app.close();
  });
});

describe("validateBody", () => {
  it("passes the parsed body through to the handler", async () => {
    const app = buildGuardHarness();
    const response = await app.inject({
      method: "POST",
      url: "/partner",
      payload: { name: "  Amina  " },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ body: { name: "Amina" } });
    await app.close();
  });

  it.each([
    ["an invalid field", { name: "" }],
    ["an unknown field", { name: "Amina", extra: 1 }],
  ])("rejects %s with 400 before the handler runs", async (_label, payload) => {
    const app = buildGuardHarness();
    const response = await app.inject({ method: "POST", url: "/partner", payload });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ outcome: "INVALID_REQUEST" });
    expect(response.json().details).toBeDefined();
    await app.close();
  });
});

describe("requirePartner", () => {
  // Named trust boundary: unauthenticated today (DOMAIN.md:25), but there is
  // exactly one place to add request signing. See DESIGN.md.
  it("admits an unauthenticated partner request", async () => {
    const app = buildGuardHarness();
    const response = await app.inject({
      method: "POST",
      url: "/partner",
      payload: { name: "Amina" },
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });
});
