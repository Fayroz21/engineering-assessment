# Issues

Ordered by risk. Line numbers refer to the code as inherited.

| # | Issue | Severity | Where | Status |
|---|---|---|---|---|
| 1 | Any customer could read any customer's application | Critical | `app.ts:26-45` | Fixed |
| 2 | A retried partner event was applied twice | Critical | `application-service.ts:65-90` | Fixed |
| 3 | A late event overwrote newer state | Critical | `application-service.ts:63-70` | Fixed |
| 4 | The documented lifecycle was not enforced | High | nowhere in code | Fixed |
| 5 | The three writes were not atomic | High | `application-service.ts:63-90` | Fixed |
| 6 | The partner could not tell what happened | High | `app.ts:66-72` | Fixed |
| 7 | One bad timestamp could freeze the integration | Medium | `contracts/index.ts` | Fixed |
| 8 | Customer free text written to logs | Medium | `app.ts:55-58` | Fixed |
| 9 | Failed notifications are never retried | High | `process-notifications.ts:71-79` | Deferred |
| 10 | Two workers would send the same notification | Medium | `process-notifications.ts:17-27` | Deferred |
| 11 | Web app has no real identity | Medium | `web/src/api.ts:5` | Deferred |
| 12 | `db push`, not migrations - no rollback path | Medium | `package.json` | Deferred |
| 13 | `/health` does not check the database | Low | `app.ts:26` | Deferred |
| 14 | CORS, rate limits, pagination, worker shutdown | Low | various | Deferred |

## Fixed

**1. Broken authorization.** The `x-customer-id` header was checked for presence
and then discarded, so any caller could read any applicant's name, email, phone
and loan amount. Ownership is now part of the query, not a separate check, so no
code path can return an application the caller does not own. "Not yours" and
"does not exist" return the identical 404, so ids cannot be enumerated.
*Breaks README.md:19, DOMAIN.md:37.*

**2. No idempotency.** The partner retries deliveries, and each delivery created
a new history row and a new notification job - phantom audit entries, duplicate
emails. Now enforced twice: a read catches the ordinary retry, and a unique
constraint on `(applicationId, sourceEventId)` catches two deliveries racing
each other, which no read-then-write check can. *Breaks DOMAIN.md:17.*

**3. No ordering guard.** Current status was overwritten by whatever arrived
last. `lastEventOccurredAt` existed and was written but never read. Stale events
are now rejected, and the status write is a compare-and-set, so state cannot
roll backwards even under concurrency. *Breaks DOMAIN.md:17.*

**4. No state machine.** `DISBURSED -> SUBMITTED` was accepted; terminal states
were not terminal. Now one data table in
`packages/contracts/src/status-transitions.ts`, asserted as a full 6x6 matrix.

**5. Not atomic.** Status, history and notification were three separate awaits.
A crash between them left a status change with no evidence, or evidence with no
notification. Now one transaction. *Breaks DOMAIN.md:19.*

**6. Every outcome returned 202.** A retry, a superseded event and a real
acceptance were indistinguishable, so the partner could not decide whether to
retry, stop, or alert. Now `202` accepted, `200` duplicate, `409` stale, `409`
invalid transition, `404` unknown, `400` malformed - each with an `outcome`
field to switch on. *Breaks DOMAIN.md:52.*

**7. Unbounded timestamps.** One event dated year 3000 would be written to
`lastEventOccurredAt`, after which every real event is stale forever. Now
rejected beyond 24h of clock skew. The schema is also `.strict()`, so a partner
typo is a 400 rather than a silently dropped field.

**8. PII in logs.** The whole payload was logged at `info`, including the
human-readable `reason`. Now identifiers and outcome only.

## Deferred

All real. Left alone to keep this to one coherent slice.

**9. Failed notifications are never retried.** `processedAt` is set in a
`finally` block, so a job that *threw* is still marked processed, and the batch
query only selects `processedAt IS NULL`. A failure is buried on its first
attempt; `nextAttemptAt` is never written. The seeded `omar@retry.invalid`
demonstrates it. This is a second vertical slice - schema, worker, and an
operator surface - and doing it badly is worse than not doing it. Pinned by
three `it.todo` entries in the worker tests. *Breaks DOMAIN.md:56.*

**10. No row claiming.** `findMany` then loop then `update` means two workers
take the same job. Belongs with #9 - same query. Partly mitigated by the
`idempotencyKey` already sent to the provider. *DOMAIN.md:58.*

**11. Web identity is hardcoded.** `cus_amina_001` for every visitor. A demo
harness, not an API bug; a real session belongs with real authentication.

**12. No migrations.** Adopting `prisma migrate` would change the setup command
the assessment requires to keep working. Covered in DESIGN.md instead.

**13-14. Smaller items.** `/health` returns ok with a dead database; CORS
reflects any origin; no rate limit or body-size cap; no request id correlating
an API log line with the worker line for the same event; history is unpaginated;
the worker's `shutdown` neither awaits the in-flight batch nor exits.

## Open questions

1. **Should `OFFERED` and `APPROVED` reach `DECLINED`?** DOMAIN.md:9-13 does not
   draw those edges, so they are rejected. A customer refusing an offer seems
   plausible in a real lender. One line in `ALLOWED_TRANSITIONS` to widen.
2. **Is a partner `eventId` unique globally or per application?** Currently
   scoped to `(applicationId, sourceEventId)`, the safer reading. A global
   constraint would also catch an event sent against the wrong application.
3. **Two events at the same millisecond.** The second is rejected as stale. A
   partner sequence number would remove the ambiguity.
