import { randomUUID } from "node:crypto";
import type {
  ApplicationStatus,
  ApplicationView,
  StatusEventInput,
} from "@assessment/contracts";
import type { Prisma, PrismaClient } from "@assessment/database";
import { decideStatusEvent } from "./status-event-policy.js";

/**
 * Accepts either the root client or an interactive-transaction client, so the
 * same read functions work inside and outside a transaction.
 */
export type DatabaseClient = PrismaClient | Prisma.TransactionClient;

type ApplicationRecord = Prisma.LoanApplicationGetPayload<{
  include: { customer: true; history: true };
}>;

/**
 * `recordedAt` breaks ties: two entries bearing the same partner timestamp
 * would otherwise come back in an order the database is free to change, and
 * this list is customer-visible and may be used as operational evidence.
 */
const APPLICATION_INCLUDE = {
  customer: true,
  history: {
    orderBy: [{ occurredAt: "desc" }, { recordedAt: "desc" }],
  },
} satisfies Prisma.LoanApplicationInclude;

export const NOTIFICATION_TYPE_STATUS_CHANGED = "APPLICATION_STATUS_CHANGED";

export type RecordStatusEventResult =
  | { outcome: "ACCEPTED"; application: ApplicationView }
  | { outcome: "DUPLICATE"; application: ApplicationView }
  | { outcome: "STALE"; application: ApplicationView }
  | {
      outcome: "INVALID_TRANSITION";
      application: ApplicationView;
      from: ApplicationStatus;
      to: ApplicationStatus;
    }
  | { outcome: "NOT_FOUND" };

/** Pure projection of a database row onto the wire shape. No I/O. */
export function toApplicationView(record: ApplicationRecord): ApplicationView {
  return {
    id: record.id,
    status: record.status as ApplicationStatus,
    requestedAmountCents: record.requestedAmountCents,
    currency: record.currency,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    customer: {
      id: record.customer.id,
      name: record.customer.name,
      email: record.customer.email,
      phone: record.customer.phone,
    },
    history: record.history.map((entry) => ({
      id: entry.id,
      status: entry.status as ApplicationStatus,
      reason: entry.reason,
      occurredAt: entry.occurredAt.toISOString(),
      recordedAt: entry.recordedAt.toISOString(),
    })),
  };
}

/**
 * Customer-scoped read for the public API.
 *
 * Ownership is part of the query, not a separate check, so there is no code
 * path that can return an application the caller does not own. Callers cannot
 * distinguish "does not exist" from "not yours" - both are `null`.
 */
export async function getApplicationForCustomer(
  database: DatabaseClient,
  applicationId: string,
  customerId: string,
): Promise<ApplicationView | null> {
  const application = await database.loanApplication.findFirst({
    where: { id: applicationId, customerId },
    include: APPLICATION_INCLUDE,
  });

  return application ? toApplicationView(application) : null;
}

/**
 * Unscoped read for the internal partner adapter, which has no customer
 * identity. Named separately from `getApplicationForCustomer` so that using
 * the unscoped path is always a visible, deliberate choice at the call site.
 */
export async function getApplicationById(
  database: DatabaseClient,
  applicationId: string,
): Promise<ApplicationView | null> {
  const application = await database.loanApplication.findUnique({
    where: { id: applicationId },
    include: APPLICATION_INCLUDE,
  });

  return application ? toApplicationView(application) : null;
}

/**
 * Applies one partner status event.
 *
 * The current state, the history entry and the notification request are one
 * logical change (DOMAIN.md:19), so all three writes happen in a single
 * transaction: a crash cannot leave a status change with no evidence, or
 * evidence with no notification.
 *
 * Idempotency is enforced twice, on purpose. The read below catches the
 * ordinary retry; the unique index on `(applicationId, sourceEventId)` catches
 * two deliveries racing each other, which no read-then-write check can. The
 * index is the guarantee - the read only makes the common case cheap.
 */
export async function recordStatusEvent(
  database: PrismaClient,
  applicationId: string,
  event: StatusEventInput,
): Promise<RecordStatusEventResult> {
  const occurredAt = new Date(event.occurredAt);

  try {
    return await database.$transaction(
      async (tx): Promise<RecordStatusEventResult> => {
        const application = await tx.loanApplication.findUnique({
          where: { id: applicationId },
        });

        if (!application) {
          return { outcome: "NOT_FOUND" };
        }

        const alreadyRecorded = await tx.applicationStatusHistory.findUnique({
          where: {
            applicationId_sourceEventId: {
              applicationId,
              sourceEventId: event.eventId,
            },
          },
          select: { id: true },
        });

        const currentStatus = application.status as ApplicationStatus;
        const decision = decideStatusEvent(
          {
            status: currentStatus,
            lastEventOccurredAt: application.lastEventOccurredAt,
          },
          { status: event.status, occurredAt },
          alreadyRecorded !== null,
        );

        if (decision !== "ACCEPT") {
          const view = await loadViewOrThrow(tx, applicationId);

          return decision === "INVALID_TRANSITION"
            ? {
                outcome: "INVALID_TRANSITION",
                application: view,
                from: currentStatus,
                to: event.status,
              }
            : { outcome: decision, application: view };
        }

        await tx.applicationStatusHistory.create({
          data: {
            id: randomUUID(),
            applicationId,
            status: event.status,
            reason: event.reason,
            sourceEventId: event.eventId,
            occurredAt,
          },
        });

        // Compare-and-set. If a newer event committed while we were working,
        // this matches no rows and current state is left alone - the history
        // entry is still recorded, but stale state never wins.
        await tx.loanApplication.updateMany({
          where: {
            id: applicationId,
            OR: [
              { lastEventOccurredAt: null },
              { lastEventOccurredAt: { lt: occurredAt } },
            ],
          },
          data: { status: event.status, lastEventOccurredAt: occurredAt },
        });

        await tx.notificationJob.create({
          data: {
            id: randomUUID(),
            applicationId,
            sourceEventId: event.eventId,
            type: NOTIFICATION_TYPE_STATUS_CHANGED,
            payload: JSON.stringify({
              status: event.status,
              reason: event.reason ?? null,
              occurredAt: occurredAt.toISOString(),
            }),
          },
        });

        return {
          outcome: "ACCEPTED",
          application: await loadViewOrThrow(tx, applicationId),
        };
      },
    );
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;

    // A concurrent delivery of the same eventId won the race and committed
    // first. Ours rolled back, so the effect the partner asked for is already
    // in place exactly once: this is a duplicate, not a failure.
    const application = await getApplicationById(database, applicationId);
    return application
      ? { outcome: "DUPLICATE", application }
      : { outcome: "NOT_FOUND" };
  }
}

/**
 * The application was found moments earlier in the same transaction, so its
 * absence here is a broken invariant rather than a business outcome. Failing
 * loudly is correct: reporting NOT_FOUND would tell the partner their event
 * was rejected when in fact something is wrong with us.
 */
async function loadViewOrThrow(
  database: DatabaseClient,
  applicationId: string,
): Promise<ApplicationView> {
  const view = await getApplicationById(database, applicationId);

  if (!view) {
    throw new Error(
      `application ${applicationId} vanished while its status event was being applied`,
    );
  }

  return view;
}

/**
 * Checked structurally rather than with `instanceof`: the error crosses the
 * generated-client boundary and the class identity is not worth depending on.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}
