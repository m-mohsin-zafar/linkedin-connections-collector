# Per-Account Incremental Refresh — Design Specification

## Purpose

Extend Connections Collector so repeated runs collect only connections newer than the last successfully completed collection for the currently signed-in LinkedIn account.

LinkedIn presents the Connections page with the most recent connections first. The extension uses the canonical profile URL of the previously observed newest connection as a positional refresh cursor. Connection dates are not cursors because they may be absent, coarse, localized, or shared by multiple connections.

## Account Identity

The content script identifies the signed-in LinkedIn account from the member's own profile link in LinkedIn's global navigation. The resulting account key is the canonical LinkedIn member profile URL.

Account detection uses semantic navigation signals such as the global navigation container, an accessible Me label, and the associated member-profile link. It does not inspect hidden application state or call an undocumented API.

Collection is blocked when the signed-in account cannot be identified reliably. The extension popup explains that the account identity is unavailable. It must never assign records to a guessed account or merge datasets across accounts.

## Storage Model

Storage version 2 contains an accounts map keyed by canonical account profile URL. Each account dataset contains:

- accountKey: the signed-in member's canonical profile URL
- displayName: the signed-in member name when it can be read reliably, otherwise null
- records: the account's normalized connection records
- refreshCursor: the canonical profile URL of the newest connection from the last successfully completed collection, otherwise null
- lastCompletedAt: completion timestamp for the run that promoted refreshCursor, otherwise null

Run state is also scoped to the account key. The popup requests the current account snapshot rather than a global record list.

Existing version 1 data has no trustworthy account identity. It remains preserved under its existing key and is not automatically assigned to a detected account. Version 2 reads and writes only the per-account key, so it does not silently mix legacy data into the current account.

## Initial Collection

An account with refreshCursor equal to null requires an initial collection:

1. Start at the top of the Connections page.
2. Record the canonical profile URL of the first valid connection as candidateCursor.
3. Continue the normal bounded collection until the end is inferred from the configured no-growth condition.
4. On no-growth completion, promote candidateCursor to refreshCursor and set lastCompletedAt.

The cursor is not promoted when the run stops for a user request, hidden tab, navigation, record limit, duration limit, checkpoint, parsing failure, or unexpected failure. A later run therefore repeats the incomplete initial collection safely.

If the page contains no valid connection records, no cursor is stored.

## Incremental Refresh

An account with a non-null refreshCursor uses refresh mode:

1. Snapshot the existing refreshCursor as previousCursor when the run starts.
2. Record the first valid connection profile URL as candidateCursor.
3. Scan and ingest rendered connections from newest to oldest.
4. Stop successfully when previousCursor appears in a parsed batch.
5. Promote candidateCursor to refreshCursor and set lastCompletedAt.

The batch containing previousCursor is still ingested. Deduplication prevents the cursor record and any other known records in the batch from being added twice.

If the first valid connection is already previousCursor, the dataset is up to date. The cursor remains unchanged and the run completes without scrolling after that scan.

If previousCursor does not appear before a safety stop or failure, the old cursor remains unchanged. If the page reaches the no-growth end condition without finding it, the run stops as Blocked with the reason cursor-not-found. The next refresh starts from the top again, ensuring no newly added connection is skipped.

## Ordering Assumption

Incremental stopping depends on LinkedIn continuing to show the Connections page in most-recent-first order. The extension does not attempt to change sorting. The popup labels refresh mode and explains that it scans from newest entries back to the saved marker.

The extension treats the cursor as a positional marker, not as proof of a connection timestamp. Export ordering remains deterministic by name and profile URL and is independent from page order.

## Messages and Boundaries

The popup resolves its context through the background service worker. The service worker asks the active Connections-page content script for AccountIdentity, validates it, and then returns that account's snapshot. The same resolution occurs before start, scan, export, and clear commands. Every storage and run-state command includes accountKey.

The background service worker:

- validates canonical account keys
- reads and writes only the addressed account dataset
- returns the account's current refreshCursor with the start snapshot
- promotes a cursor only in response to an explicit successful-completion command
- preserves serialized writes per account

The collection state machine:

- owns previousCursor and candidateCursor for one run
- compares canonical profile URLs from parsed candidates
- adds the stop reasons up-to-date and cursor-not-found
- emits a successful cursor-promotion request only for up-to-date or completed initial no-growth outcomes

The popup displays the detected account identity, Initial collection or Refresh mode, and the last successful refresh time when available.

CSV and JSON exports contain only the current detected account's records. Clear collected data removes only that account's dataset after confirmation.

## Error Handling

- Missing or ambiguous account identity blocks collection before any ingestion.
- A malformed saved cursor is ignored as corrupt metadata, leaves the account in initial-collection mode, and surfaces a storage warning.
- A cursor absent because a connection was removed, hidden, or no longer reachable does not cause promotion; the old cursor is retained.
- Account changes during a run stop collection as blocked and do not promote the cursor.
- Storage updates remain serialized so simultaneous batches cannot overwrite records or cursor metadata.

## Testing

Automated tests cover:

- signed-in account detection from semantic navigation markup
- missing and ambiguous account detection
- independent storage and counters for two accounts
- preservation of version 1 data without automatic assignment
- candidate cursor selection from the first valid connection
- immediate up-to-date completion when the old cursor is first
- ingestion of the batch containing the old cursor
- cursor promotion after reaching an old cursor
- first-run promotion only after no-growth completion
- no promotion after every interruption, limit, blocking, and failure condition
- safe behavior when the saved cursor is malformed or never appears
- popup account, mode, and last-completed rendering
- current-account-only export and clear behavior

Manual acceptance uses two LinkedIn accounts only if the user already has them available. It verifies that switching accounts changes the active dataset and never displays or updates the other account's records.

## Out of Scope

- Guessing an account identity when global navigation does not expose one
- User-created aliases or manual account mapping
- Migrating or assigning version 1 records to an account
- Using dates as refresh cursors
- Detecting reordering beyond the most-recent-first assumption
- Automatically visiting profiles

## Acceptance Criteria

The feature is complete when each detected LinkedIn account has an isolated dataset and refresh cursor; a completed refresh stops when it reaches the previous cursor and then promotes the newest observed profile URL; a completed initial collection promotes its first observed profile URL at no-growth; and every partial, interrupted, limited, blocked, or failed run leaves the previous cursor unchanged.
