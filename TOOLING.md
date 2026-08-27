# Tooling

| Tool | Used for |
|---|---|
| **Claude Opus 5** via **Claude Code** (VS Code) | Reading the codebase, drafting the slice, writing tests, drafting these documents |
| `pnpm check` - ESLint, `tsc`, Vitest, Next build | The actual verification |
| `curl` + `sqlite3` | End-to-end checks against a running stack |
| Prisma CLI (`db push`, `studio`) | Schema changes and inspecting the resulting rows |

## How I used it

**Read before writing.** The first pass was orientation only - every source
file plus README and DOMAIN - to find the gaps between the documented behaviour
and the code. That produced a list of spec violations, not style complaints.

**Prioritised by hand.** The model produced a longer issue list than what is in
ISSUES.md. Choosing one coherent slice, and deciding what to leave alone, was
mine - that judgement is the point of the exercise.

**Decisions I made against the first suggestion:**

- Keep `decideStatusEvent` **pure and separate** from persistence. The first
  draft had the checks inline in the transaction - correct, but untestable
  without a database. Splitting it is why the slice has 24 fast unit tests.
- **Guards, not inline checks.** Identity and validation moved into Fastify
  `preHandler` hooks, so handlers hold no auth logic.
- **Ownership in the query, not in a guard.** A guard can be forgotten on the
  next route; `where: { id, customerId }` cannot.
- **A structural `BodyValidator` interface** rather than importing Zod into the
  API, so a guard does not pull in a validation library.
- **Delete dead branches rather than test them.** Coverage flagged two
  unreachable `NOT_FOUND` paths; the right answer was to remove them and fail
  loudly on a broken invariant, not to test code that cannot run.

## How I checked the output

1. **Typecheck after every layer** - schema, contracts, policy, service, routes.
2. **Each test names the inherited defect it would have caught** - duplicate
   applied twice, state rolling backwards, terminal state escaping,
   cross-customer read.
3. **The database asserted, not just the status code.** "Returns 409" and "wrote
   nothing" are different claims.
4. **A concurrency test** firing five identical deliveries at once, asserting
   exactly one history row and one job - this is what proves the constraint, not
   the read, carries idempotency.
5. **Coverage thresholds enforced in `pnpm check`**, so the claim is checked by
   CI rather than asserted here.
6. **A live run** against a real server and SQLite file, inspecting rows
   afterwards - passing tests and a working system are not the same claim.

## Where I did not trust it

- The first transition table allowed `OFFERED -> DECLINED`, which DOMAIN.md does
  not document. I narrowed it to exactly what is drawn and raised it as an open
  question instead of guessing at a business rule.
- A suggested `as const` on the Prisma `include` produced a readonly type Prisma
  rejects - caught by `tsc`, not by review.
- A test named "fails the job when its application has been removed" actually
  proved something else: the job cascades away with the application, so that
  branch is unreachable. Renamed to state what it really shows.
