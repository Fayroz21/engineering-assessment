import { statusEventSchema, type StatusEventInput } from "@assessment/contracts";
import { prisma, type PrismaClient } from "@assessment/database";
import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  getApplicationForCustomer,
  recordStatusEvent,
} from "./application-service.js";
import { requireCustomer, requirePartner, validateBody } from "./guards.js";

interface BuildAppOptions {
  database?: PrismaClient;
  logger?: boolean;
}

export function buildApp(options: BuildAppOptions = {}) {
  const database = options.database ?? prisma;
  const app = Fastify({ logger: options.logger ?? true });

  void app.register(cors, { origin: true });

  // Backing store for the `requireCustomer` guard, the Fastify equivalent of
  // an injected request-scoped identity.
  app.decorateRequest("customerId", "");

  app.get("/health", async () => ({ status: "ok" }));

  app.get<{ Params: { applicationId: string } }>(
    "/v1/applications/:applicationId",
    { preHandler: [requireCustomer] },
    async (request, reply) => {
      const application = await getApplicationForCustomer(
        database,
        request.params.applicationId,
        request.customerId,
      );

      // One response for "no such application" and for "not yours", so the API
      // never discloses that an inaccessible application exists (DOMAIN.md:37).
      if (!application) {
        return reply
          .code(404)
          .send({ outcome: "NOT_FOUND", error: "application not found" });
      }

      return application;
    },
  );

  app.post<{ Params: { applicationId: string }; Body: StatusEventInput }>(
    "/v1/applications/:applicationId/status-events",
    { preHandler: [requirePartner, validateBody(statusEventSchema)] },
    async (request, reply) => {
      const applicationId = request.params.applicationId;
      const result = await recordStatusEvent(
        database,
        applicationId,
        request.body,
      );

      // Identifiers and the outcome only. The free-text `reason` is customer
      // content and does not belong in application logs.
      request.log.info(
        {
          applicationId,
          eventId: request.body.eventId,
          status: request.body.status,
          outcome: result.outcome,
        },
        "partner status event processed",
      );

      switch (result.outcome) {
        // Recorded. History and notification are queued.
        case "ACCEPTED":
          return reply
            .code(202)
            .send({ outcome: result.outcome, application: result.application });

        // Already applied exactly once. A safe retry, not an error: the
        // partner should stop retrying and treat this as success.
        case "DUPLICATE":
          return reply
            .code(200)
            .send({ outcome: result.outcome, application: result.application });

        // Superseded by a newer event. Retrying will never succeed.
        case "STALE":
          return reply.code(409).send({
            outcome: result.outcome,
            error: "event is older than the current application state",
            application: result.application,
          });

        // Not a legal move in the documented lifecycle. Retrying will never
        // succeed; this warrants an alert on the partner side.
        case "INVALID_TRANSITION":
          return reply.code(409).send({
            outcome: result.outcome,
            error: `cannot move from ${result.from} to ${result.to}`,
            from: result.from,
            to: result.to,
            application: result.application,
          });

        case "NOT_FOUND":
          return reply
            .code(404)
            .send({ outcome: result.outcome, error: "application not found" });
      }
    },
  );

  return app;
}
