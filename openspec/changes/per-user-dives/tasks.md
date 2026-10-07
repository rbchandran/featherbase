# Tasks

- [x] 1.1 `apps/server/test/dive-assignment.test.ts` (8): the assigned user lists and opens their Dive with the pinned Dive, version and starting state sent upstream; sign-in lands a user with only a Dive on it; another user's Dive and an unknown one are the same 404 with no upstream call; routes need a session and the Table is 403 to the reader; re-assigning updates the row in place; a malformed Dive id or version is refused before anything is written; no service account answers not_configured; an upstream refusal is a 502 with its status.
- [x] 1.2 `apps/web/test/dive-report-page.test.tsx` (3): own Dive framed from the embed origin; another user's Dive says so and is never framed; the report page links to the reader's Dives.
- [x] 1.3 `pnpm --filter server assign:dive -- --user … --dive … --version … --title …` creates the Table if missing and the row, idempotently.
- [ ] 2.1 On the deployment: confirm SERVICE_ACCOUNT can read every share the Dive attaches, then run the script for RR-10104 with Dive 89449583-1c0d-467a-a50c-b3e5931ec132 version 120.
