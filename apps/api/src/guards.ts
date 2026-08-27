import type { preHandlerHookHandler } from "fastify";

/**
 * Route guards.
 *
 * Fastify has no decorator syntax, so the equivalent of a NestJS
 * `@UseGuards(...)` is a `preHandler` hook composed declaratively into the
 * route definition, and the equivalent of a `@GetUser()` param decorator is
 * `app.decorateRequest`. Handlers therefore contain no identity or validation
 * logic at all - by the time a handler runs, both have already passed.
 */

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `requireCustomer`. Empty until that guard has run. */
    customerId: string;
  }
}

/**
 * Authenticated-caller guard.
 *
 * `x-customer-id` is the exercise's stand-in for a session (DOMAIN.md:23) and
 * is caller-controlled, so it establishes *identity only*.
 *
 * Ownership is deliberately NOT checked here. It belongs in the data query
 * (`where: { id, customerId }`) for two reasons: an ownership guard would need
 * its own database read, and - more importantly - a guard can be forgotten on
 * the next route somebody adds, whereas a scoped query cannot silently return
 * another customer's row.
 */
export const requireCustomer: preHandlerHookHandler = async (
  request,
  reply,
) => {
  const header = request.headers["x-customer-id"];

  if (typeof header !== "string" || header.trim().length === 0) {
    return reply.code(401).send({
      outcome: "UNAUTHENTICATED",
      error: "customer identity is required",
    });
  }

  request.customerId = header.trim();
};

/**
 * Trust boundary for the partner integration adapter.
 *
 * Authentication of the partner feed is out of scope for the exercise
 * (DOMAIN.md:25), but the boundary is named here so there is exactly one place
 * to add request signing or mTLS, and so route definitions state plainly that
 * this endpoint is internal rather than customer-facing. See DESIGN.md.
 */
export const requirePartner: preHandlerHookHandler = async (request) => {
  request.log.debug("partner adapter request accepted without authentication");
};

/**
 * The only thing this guard needs from a schema. Declared structurally rather
 * than importing Zod, so the API layer does not take a dependency on a
 * particular validation library to run one guard.
 */
export interface BodyValidator<T> {
  safeParse(input: unknown):
    | { success: true; data: T }
    | { success: false; error: { flatten(): unknown } };
}

/**
 * Schema guard. Rejects malformed bodies before the handler runs and replaces
 * `request.body` with the parsed, coerced value so handlers never re-validate.
 */
export function validateBody<T>(
  schema: BodyValidator<T>,
): preHandlerHookHandler {
  return async (request, reply) => {
    const parsed = schema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        outcome: "INVALID_REQUEST",
        error: "invalid status event",
        details: parsed.error.flatten(),
      });
    }

    (request as { body: unknown }).body = parsed.data;
  };
}
