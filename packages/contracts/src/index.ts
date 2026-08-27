import { z } from "zod";

export const APPLICATION_STATUSES = [
  "SUBMITTED",
  "IN_REVIEW",
  "OFFERED",
  "APPROVED",
  "DECLINED",
  "DISBURSED",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * How far ahead of our own clock a partner timestamp may be.
 *
 * Without this bound a single bad partner timestamp (say the year 3000) is
 * written to `lastEventOccurredAt` and every subsequent legitimate event is
 * then rejected as stale, permanently. A day absorbs ordinary clock skew.
 */
export const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

export const statusEventSchema = z
  .object({
    eventId: z.string().trim().min(1).max(100),
    status: z.enum(APPLICATION_STATUSES),
    occurredAt: z
      .string()
      .datetime({ offset: true })
      .refine((value) => Date.parse(value) <= Date.now() + MAX_CLOCK_SKEW_MS, {
        message: "occurredAt is too far in the future",
      }),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  // Reject unknown keys rather than silently dropping them: a partner typo
  // ("staus") should surface as a 400, not as a field we quietly ignore.
  .strict();

export type StatusEventInput = z.infer<typeof statusEventSchema>;

/** How the partner adapter classifies a delivery. Mirrored in the HTTP layer. */
export const STATUS_EVENT_OUTCOMES = [
  "ACCEPTED",
  "DUPLICATE",
  "STALE",
  "INVALID_TRANSITION",
  "NOT_FOUND",
] as const;

export type StatusEventOutcome = (typeof STATUS_EVENT_OUTCOMES)[number];

export interface ApplicationView {
  id: string;
  status: ApplicationStatus;
  requestedAmountCents: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  customer: {
    id: string;
    name: string;
    email: string;
    phone: string;
  };
  history: Array<{
    id: string;
    status: ApplicationStatus;
    reason: string | null;
    occurredAt: string;
    recordedAt: string;
  }>;
}

export {
  allowedTransitionsFrom,
  canTransition,
  isTerminal,
} from "./status-transitions.js";
