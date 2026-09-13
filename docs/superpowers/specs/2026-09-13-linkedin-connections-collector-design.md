# LinkedIn Connections Collector — Design Specification

## Purpose

Build a Chrome extension that lets the user collect coarse information about their own LinkedIn connections from the LinkedIn Connections page. The first version collects only information already rendered in the browser, stores it locally, and exports matching CSV and JSON datasets.

The extension is user-operated. It does not call undocumented LinkedIn APIs, bypass access controls, solve checkpoints, imitate human behavior, or automatically visit individual profiles.

## MVP Scope

Each connection record contains:

- name: displayed connection name
- headline: displayed headline, when available
- profileUrl: canonicalized LinkedIn profile URL
- connectedOn: displayed connection date, when available
- collectedAt: ISO 8601 timestamp for the first successful collection

The extension excludes profile photos and does not enrich records from profile pages. The schema may gain optional enrichment fields later without changing the MVP collection flow.

## User Experience

The extension popup displays:

- Current state: Idle, Collecting, Completed, or Blocked
- Total unique connections
- Records added during the current run
- Duplicate count
- Parse-failure count
- Start collecting
- Stop
- Scan visible page
- Clear data
- Export CSV
- Export JSON
- Maximum-record and maximum-duration controls
- A notice that collected records remain on the device

Closing the popup does not delete collected data or stop an active run. A run interrupted by navigation, tab closure, browser restart, or extension reload does not resume automatically.

## Architecture

The project is a Chrome Manifest V3 extension with three main boundaries:

1. The content script reads the Connections page, parses visible connection cards, detects page state, and performs bounded scrolling.
2. The background service worker coordinates popup commands, persists records and run state, and creates export downloads.
3. The popup renders status and controls. It does not scrape the page directly.

Communication uses typed message-shaped objects with explicit command and response names. Collection and export logic remain independent so each can be tested without Chrome UI automation.

## Collection Flow

1. The user opens LinkedIn's Connections page and selects Start collecting.
2. The content script confirms that the current page is supported and visible.
3. It scans rendered connection cards and sends parsed candidates to the service worker.
4. The service worker validates and merges candidates into local storage.
5. The content script scrolls by a moderate viewport-relative increment.
6. It waits for a DOM mutation, document growth, or a bounded render timeout before rescanning.
7. The process repeats until a stop condition occurs.

Scan visible page performs steps 2–4 once and never scrolls.

Waits exist to allow stable rendering. The implementation will not randomize behavior to evade detection or present itself as human activity.

## Stop and Blocking Conditions

Collection stops when:

- The user selects Stop
- The maximum-record limit is reached
- The maximum-duration limit is reached
- The page or tab is no longer visible
- Navigation leaves the supported Connections page
- Several consecutive cycles produce no new cards or document growth
- LinkedIn displays a login prompt, verification checkpoint, challenge, or access error
- Repeated parsing failures indicate that the page markup is unsupported

Already saved records remain available after every stop. The extension never attempts to dismiss or work around a LinkedIn checkpoint.

## Parsing and Canonicalization

The parser uses a small ordered set of resilient signals rather than one generated CSS class. Preferred signals include profile links, accessible labels, semantic list/card structure, and nearby visible text.

Candidate records are rejected if either a usable name or a valid LinkedIn member profile URL is missing. Profile URLs are canonicalized by removing query parameters, fragments, and trailing slashes while preserving the member path.

The canonical profile URL is the primary deduplication key. When a duplicate is found, later non-empty headline or connection-date values fill missing values; they do not overwrite existing non-empty values. collectedAt retains the earliest timestamp.

## Storage and Privacy

Records and run metadata are stored with chrome.storage.local. No collected information is sent to a server or third-party service. The manifest requests only the permissions necessary for local storage, downloads, and operation on the relevant LinkedIn pages.

Clear data requires a confirmation in the popup and removes collected records and run metadata. Export does not delete stored data.

## Export Formats

CSV and JSON exports are generated from the same normalized, deterministically sorted dataset.

CSV:

- UTF-8 with a header row
- Columns: name, headline, profileUrl, connectedOn, collectedAt
- Correct quoting for commas, quotes, and line breaks
- Spreadsheet-safe handling of values beginning with formula-triggering characters

JSON:

- UTF-8, pretty-printed
- A top-level metadata object containing schema version, export timestamp, and record count
- A connections array containing normalized records

## Error Handling

Errors are classified as unsupported page, checkpoint detected, storage failure, parse failure, limit reached, or unexpected failure. The popup displays a short actionable message and preserves prior records.

Malformed cards increment the parse-failure counter without aborting an otherwise healthy run. Repeated broad parsing failure blocks the run to prevent silent collection of corrupt data.

## Testing

Automated tests cover:

- Parsing representative synthetic DOM fixtures
- Missing optional fields and malformed cards
- URL canonicalization
- Deduplication and merge rules
- Page-stability and no-growth stop conditions
- User, record-limit, duration-limit, hidden-tab, navigation, and checkpoint stops
- CSV escaping and spreadsheet-formula safety
- JSON shape, metadata, and deterministic ordering
- Service-worker state transitions
- Popup rendering and commands

A manual acceptance test loads the unpacked extension in Chrome and verifies scanning, bounded scrolling, stopping, persistence, clearing, and both exports on the user's Connections page. Real LinkedIn data is not committed to the repository.

## Out of Scope

- Automatic profile visits or profile enrichment
- Background crawling after the user leaves the page
- Undocumented LinkedIn API calls
- CAPTCHA, checkpoint, rate-limit, or access-control circumvention
- Cloud synchronization or remote databases
- Scheduled or unattended collection
- Messaging, inviting, following, or modifying LinkedIn accounts

## Acceptance Criteria

The MVP is complete when the user can manually scan or start a bounded collection run on the Connections page, stop it at any time, retain unique normalized records locally, and export equivalent CSV and JSON datasets with the agreed fields. It must stop safely on unsupported pages, hidden tabs, checkpoints, configured limits, and repeated no-growth or parsing-failure conditions.
