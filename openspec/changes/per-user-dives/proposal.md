# Proposal

## Why

The report page frames one MotherDuck Dive, the same one for every reader. A Store Manager
needs a second, store-wide Dive as well (the Attakulangara Store TL Cockpit, `89449583…`),
and there is no way to give one named person one more Dive without changing it for everyone.

## What Changes

- A Dive Assignment Table names, per row, one user, one Dive, its pinned version, a title and
  an optional starting state.
- A signed-in user opens any Dive assigned to them on its own page. The server checks the row is
  theirs and mints a fresh embed session; someone else's Dive is refused the same way as no Dive.
- The report page links to the reader's assigned Dives. A user with no report role but an
  assigned Dive lands on that Dive at sign-in.
- An admin script creates the Table if it is missing and the row (or updates it in place).

## Non-goals

- Featherbase does not limit what an assigned Dive shows. Its starting state is a convenience;
  the Dive's own filters stay editable. A whole-store Dive goes only to someone who may see the
  whole store.

## Capabilities

### Modified Capabilities

- `sales-target-report`: adds Dives assigned to one person.

## Impact

- `apps/server/src/dive-assignment.ts` (new), `/api/dives` mounted in `index.ts`, the sign-in landing.
- `apps/web/src/pages/DiveReport.tsx` (new), its route, and the links on `SalesTarget.tsx`.
- `apps/server/scripts/assign-dive.ts` (new). The Table is optional: an instance without it behaves as before.
