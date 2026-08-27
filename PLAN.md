# Limitations and next steps

## Scope of this submission

One vertical slice - the partner status-event path - from database constraint to
HTTP contract, plus the authorization hole because it was small and severe.
ISSUES.md #1-8 are fixed and tested. #9-14 are not.

## Known limitations

| Limitation | Why it matters |
|---|---|
| Failed notifications are never retried | The biggest gap. Three `it.todo` entries in the worker tests name the missing behaviour so it shows in test output, not just prose |
| Stale events are rejected, not recorded | A late event leaves no trace. Recording it as *superseded* would keep the evidence |
| Two events at the same millisecond | The second is treated as stale. Only a partner sequence number fixes this properly |
| The transition table may be too narrow | `OFFERED`/`APPROVED` → `DECLINED` are rejected because DOMAIN.md does not draw them. One line to widen if that is wrong |
| No component tests for the React page | Formatters were extracted to `web/src/format.ts` and unit tested; the JSX itself is unverified. `jsdom` + Testing Library was not worth the weight for markup with no branching |
| Tests share one SQLite file | Deterministic via `--no-file-parallelism` and `deleteMany`, but a crashed test can leak state. Per-test transactional rollback would be better |
| Web app has no real identity | Every visitor is `cus_amina_001`. The API is now safe; the demo harness is not an auth system |
| `prisma db push`, not migrations | No migration history, so no rollback path. Changing it would break the required setup command |

## Next steps, in order

1. **Worker retry and dead letters.** Move `processedAt` out of the `finally`
   block; write `nextAttemptAt` with backoff and jitter; cap attempts; add a
   `DEAD_LETTERED` state keeping the last error. Fills the three `it.todo`s.
2. **Operator surface for exhausted work.** List dead-lettered jobs with their
   reason, plus an idempotent replay. DOMAIN.md:56 asks for this.
3. **Worker row claiming.** Conditional update with a visibility timeout, so two
   workers cannot deliver the same notification.
4. **Request correlation id.** Cheap, and the single biggest improvement to
   incident diagnosis.
5. **Real authentication.** Verified session for customers, signed webhooks or
   mTLS for the partner. Both slot into the existing guards.
6. **Record stale events as superseded** rather than discarding them.
7. **Migrations** via `prisma migrate`, with expand/contract discipline.
8. **Smaller items** - database-backed `/health`, rate limiting, history
   pagination, tighter CORS, graceful worker shutdown.

## Verifying

```sh
pnpm run setup     # install, generate client, recreate and seed the database
pnpm check         # lint + typecheck + tests with coverage gate + build
```

104 tests, 3 todo. Coverage thresholds are enforced by `pnpm check`: 90% on
`apps/api/src` and `packages/contracts/src`, 80% globally.

For a live check, `pnpm dev` then:

```sh
A=http://localhost:3001/v1/applications/app_home_001/status-events
post() { printf "%-14s -> %s\n" "$1" "$(curl -s -o /dev/null -w '%{http_code}' $A \
  -H 'content-type: application/json' -d "$2")"; }

post accepted  '{"eventId":"e1","status":"IN_REVIEW","occurredAt":"2026-08-20T10:30:00.000Z"}'
post duplicate '{"eventId":"e1","status":"IN_REVIEW","occurredAt":"2026-08-20T10:30:00.000Z"}'
post stale     '{"eventId":"e2","status":"OFFERED","occurredAt":"2026-08-20T09:00:00.000Z"}'
post illegal   '{"eventId":"e3","status":"DISBURSED","occurredAt":"2026-08-20T11:00:00.000Z"}'
post malformed '{"eventId":"e4","status":"IN_REVIEW","occurredAt":"2026-08-20T11:00:00.000Z","staus":"x"}'

curl -s -o /dev/null -w 'cross-customer -> %{http_code}\n' \
  http://localhost:3001/v1/applications/app_auto_002 -H 'x-customer-id: cus_amina_001'
```

Expect `202 200 409 409 400`, and `404` for the cross-customer read. `pnpm
db:studio` then shows one history row and one notification job per accepted
event - the replay, the stale event and the illegal transition wrote nothing.
