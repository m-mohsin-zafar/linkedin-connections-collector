# LinkedIn Connections Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build a Chrome Manifest V3 extension that collects rendered LinkedIn connection records through user-triggered scans or bounded scrolling and exports equivalent CSV and JSON files.

**Architecture:** A content script owns page parsing and bounded scrolling, a service worker owns persistence and downloads, and a small popup owns controls and status. Pure TypeScript modules contain normalization, merging, parsing, export, and collector state logic so most behavior is testable outside Chrome.

**Tech Stack:** TypeScript, Chrome Extensions Manifest V3, vanilla HTML/CSS, esbuild, Vitest, jsdom

**Spec:** docs/superpowers/specs/2026-09-13-linkedin-connections-collector-design.md

## Global Constraints

- Collect only information already rendered on LinkedIn's Connections page.
- Store records and run metadata locally with chrome.storage.local.
- Export UTF-8 CSV and pretty-printed JSON from the same normalized dataset.
- Do not call undocumented LinkedIn APIs, bypass access controls, solve checkpoints, imitate human behavior, or automatically visit profiles.
- Stop on hidden tabs, unsupported navigation, checkpoints, configured limits, repeated no-growth cycles, or repeated broad parse failures.
- Real LinkedIn data must never be committed to the repository.
- This directory is not currently a Git repository; commit steps become applicable after Git is initialized.

---

## File Structure

- package.json: scripts and development dependencies
- tsconfig.json: strict TypeScript configuration
- vitest.config.ts: jsdom test configuration
- scripts/build.mjs: deterministic extension build into dist
- src/manifest.json: Manifest V3 permissions, popup, service worker, and content script registration
- src/shared/types.ts: records, run state, settings, messages, and result types
- src/shared/records.ts: URL canonicalization, record validation, deduplication, and merging
- src/shared/export.ts: deterministic CSV and JSON serialization
- src/content/parser.ts: supported-page, checkpoint, and rendered-card parsing
- src/content/collector.ts: bounded collection state machine with injectable page and clock adapters
- src/content/index.ts: browser DOM adapter and service-worker messaging
- src/background/storage.ts: chrome.storage.local repository
- src/background/index.ts: command routing, tab messaging, run metadata, and downloads
- src/popup/index.html: popup markup
- src/popup/styles.css: popup visual styles
- src/popup/index.ts: popup rendering and command handlers
- tests/records.test.ts: normalization and merge behavior
- tests/parser.test.ts: synthetic DOM parsing and page detection
- tests/export.test.ts: CSV/JSON correctness and safety
- tests/collector.test.ts: collection state and stop conditions
- tests/storage.test.ts: repository behavior with a fake Chrome storage area
- tests/popup.test.ts: popup state rendering and commands

---

### Task 1: Project Scaffold and Record Domain

**Files:**
- Create: package.json
- Create: tsconfig.json
- Create: vitest.config.ts
- Create: scripts/build.mjs
- Create: src/manifest.json
- Create: src/shared/types.ts
- Create: src/shared/records.ts
- Test: tests/records.test.ts

**Interfaces:**
- Produces: canonicalizeProfileUrl(value: string): string | null
- Produces: normalizeCandidate(candidate: ConnectionCandidate, collectedAt: string): ConnectionRecord | null
- Produces: mergeRecords(existing: ConnectionRecord[], incoming: ConnectionRecord[]): MergeResult
- Produces: shared ConnectionRecord, ConnectionCandidate, MergeResult, RunState, CollectorSettings, ExtensionMessage, and ExtensionResponse types

- [ ] **Step 1: Write failing record-domain tests**

~~~ts
import { describe, expect, it } from "vitest";
import { canonicalizeProfileUrl, mergeRecords, normalizeCandidate } from "../src/shared/records";

describe("canonicalizeProfileUrl", () => {
  it("keeps only an HTTPS LinkedIn member path", () => {
    expect(canonicalizeProfileUrl("https://www.linkedin.com/in/ada-lovelace/?trk=abc#x"))
      .toBe("https://www.linkedin.com/in/ada-lovelace");
  });

  it("rejects non-member and external URLs", () => {
    expect(canonicalizeProfileUrl("https://example.com/in/ada")).toBeNull();
    expect(canonicalizeProfileUrl("https://www.linkedin.com/company/openai")).toBeNull();
  });
});

describe("normalizeCandidate", () => {
  it("trims values and requires name plus member URL", () => {
    expect(normalizeCandidate(
      { name: " Ada Lovelace ", headline: " Engineer ", profileUrl: "https://linkedin.com/in/ada/" },
      "2026-09-13T00:00:00.000Z",
    )).toEqual({
      name: "Ada Lovelace",
      headline: "Engineer",
      profileUrl: "https://www.linkedin.com/in/ada",
      connectedOn: null,
      collectedAt: "2026-09-13T00:00:00.000Z",
    });
  });
});

describe("mergeRecords", () => {
  it("deduplicates by URL, fills blanks, and keeps earliest collectedAt", () => {
    const result = mergeRecords(
      [{ name: "Ada", headline: null, profileUrl: "https://www.linkedin.com/in/ada", connectedOn: null, collectedAt: "2026-09-13T00:00:00.000Z" }],
      [{ name: "Ada Lovelace", headline: "Engineer", profileUrl: "https://www.linkedin.com/in/ada", connectedOn: "Connected August 2026", collectedAt: "2026-09-14T00:00:00.000Z" }],
    );
    expect(result.added).toBe(0);
    expect(result.duplicates).toBe(1);
    expect(result.records[0]).toMatchObject({ name: "Ada", headline: "Engineer", connectedOn: "Connected August 2026", collectedAt: "2026-09-13T00:00:00.000Z" });
  });
});
~~~

- [ ] **Step 2: Run the tests and verify failure**

Run: npm install && npm test -- tests/records.test.ts

Expected: FAIL because the shared record modules do not exist.

- [ ] **Step 3: Add strict project configuration and shared types**

Use package scripts:

~~~json
{
  "scripts": {
    "build": "node scripts/build.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "check": "npm run typecheck && npm test && npm run build"
  },
  "devDependencies": {
    "@types/chrome": "^0.1.0",
    "esbuild": "^0.25.0",
    "jsdom": "^26.0.0",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  }
}
~~~

Define records with nullable optional display fields, collector states idle, collecting, paused, completed, and blocked, settings maxRecords and maxDurationMs, and discriminated message names START_COLLECTION, STOP_COLLECTION, SCAN_VISIBLE, GET_SNAPSHOT, CLEAR_DATA, EXPORT_CSV, EXPORT_JSON, INGEST_RECORDS, and UPDATE_RUN.

- [ ] **Step 4: Implement minimal record normalization and merging**

~~~ts
export function canonicalizeProfileUrl(value: string): string | null {
  try {
    const url = new URL(value, "https://www.linkedin.com");
    const match = url.pathname.match(/^\/in\/([^/]+)\/?$/i);
    if (!/^(www\.)?linkedin\.com$/i.test(url.hostname) || !match) return null;
    return "https://www.linkedin.com/in/" + match[1];
  } catch {
    return null;
  }
}
~~~

normalizeCandidate trims text, converts empty optional values to null, and rejects a blank name or invalid URL. mergeRecords indexes by profileUrl, fills only missing headline and connectedOn values, retains the existing non-empty name, and reports added and duplicate counts.

- [ ] **Step 5: Add the build script and minimal manifest**

The build script must empty and recreate dist, bundle the three entry points as browser IIFEs, and copy manifest, popup HTML, and CSS. The manifest must request storage and downloads, use activeTab, and limit host permissions and the content script match to https://www.linkedin.com/mynetwork/invite-connect/connections/*.

- [ ] **Step 6: Verify the task**

Run: npm run typecheck && npm test -- tests/records.test.ts && npm run build

Expected: all commands pass and dist/manifest.json exists.

- [ ] **Step 7: Commit when Git is available**

~~~bash
git add package.json package-lock.json tsconfig.json vitest.config.ts scripts src/shared src/manifest.json tests/records.test.ts
git commit -m "feat: scaffold extension record domain"
~~~

---

### Task 2: Rendered Connections Page Parser

**Files:**
- Create: src/content/parser.ts
- Test: tests/parser.test.ts

**Interfaces:**
- Consumes: ConnectionCandidate from src/shared/types.ts
- Produces: isSupportedConnectionsPage(location: Pick<Location, "hostname" | "pathname">): boolean
- Produces: detectCheckpoint(document: Document): string | null
- Produces: parseConnectionCards(document: Document): ParseResult
- ParseResult is { candidates: ConnectionCandidate[]; failures: number; examined: number }

- [ ] **Step 1: Write failing parser tests with synthetic markup**

~~~ts
import { describe, expect, it } from "vitest";
import { detectCheckpoint, isSupportedConnectionsPage, parseConnectionCards } from "../src/content/parser";

it("recognizes only the Connections page", () => {
  expect(isSupportedConnectionsPage({ hostname: "www.linkedin.com", pathname: "/mynetwork/invite-connect/connections/" })).toBe(true);
  expect(isSupportedConnectionsPage({ hostname: "www.linkedin.com", pathname: "/feed/" })).toBe(false);
});

it("parses a rendered connection card from semantic signals", () => {
  document.body.innerHTML = '<main><li><a href="/in/ada/?trk=x"><span aria-hidden="true">Ada Lovelace</span></a><p>Engineer</p><time>Connected August 2026</time></li></main>';
  expect(parseConnectionCards(document)).toEqual({
    candidates: [{ name: "Ada Lovelace", headline: "Engineer", profileUrl: "https://www.linkedin.com/in/ada/?trk=x", connectedOn: "Connected August 2026" }],
    failures: 0,
    examined: 1,
  });
});

it("detects login and verification checkpoints", () => {
  document.body.innerHTML = '<main><h1>Let’s do a quick verification</h1></main>';
  expect(detectCheckpoint(document)).toMatch(/verification/i);
});
~~~

- [ ] **Step 2: Run tests and verify failure**

Run: npm test -- tests/parser.test.ts

Expected: FAIL because src/content/parser.ts does not exist.

- [ ] **Step 3: Implement resilient, bounded parsing**

Find unique anchors whose href resolves to /in/{slug}. For each anchor, select the nearest li or role=listitem container, derive the name from accessible or visible link text, and derive headline and connection date from visible sibling text. Never read image URLs, hidden script data, or network state. Count an examined member-link container as a failure when a valid name cannot be derived.

Checkpoint detection searches visible headings, dialogs, and main text for a small case-insensitive set: verification, security check, sign in, unusual activity, and challenge. It returns the matched reason instead of interacting with the page.

- [ ] **Step 4: Verify parser behavior**

Run: npm run typecheck && npm test -- tests/parser.test.ts

Expected: PASS for supported routes, parsing, malformed cards, duplicate anchors, and checkpoint detection.

- [ ] **Step 5: Commit when Git is available**

~~~bash
git add src/content/parser.ts tests/parser.test.ts
git commit -m "feat: parse rendered LinkedIn connection cards"
~~~

---

### Task 3: Safe CSV and JSON Export

**Files:**
- Create: src/shared/export.ts
- Test: tests/export.test.ts

**Interfaces:**
- Consumes: ConnectionRecord from src/shared/types.ts
- Produces: serializeCsv(records: ConnectionRecord[]): string
- Produces: serializeJson(records: ConnectionRecord[], exportedAt: string): string
- Produces: sortRecords(records: ConnectionRecord[]): ConnectionRecord[]

- [ ] **Step 1: Write failing export tests**

~~~ts
import { expect, it } from "vitest";
import { serializeCsv, serializeJson } from "../src/shared/export";

const record = {
  name: '=HYPERLINK("bad")',
  headline: 'Builder, "tools"',
  profileUrl: "https://www.linkedin.com/in/ada",
  connectedOn: null,
  collectedAt: "2026-09-13T00:00:00.000Z",
};

it("quotes CSV and neutralizes spreadsheet formulas", () => {
  const csv = serializeCsv([record]);
  expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
  expect(csv).toContain('"Builder, ""tools"""');
});

it("emits versioned JSON metadata and records", () => {
  const parsed = JSON.parse(serializeJson([record], "2026-09-14T00:00:00.000Z"));
  expect(parsed).toMatchObject({ schemaVersion: 1, exportedAt: "2026-09-14T00:00:00.000Z", recordCount: 1 });
  expect(parsed.connections).toHaveLength(1);
});
~~~

- [ ] **Step 2: Run tests and verify failure**

Run: npm test -- tests/export.test.ts

Expected: FAIL because src/shared/export.ts does not exist.

- [ ] **Step 3: Implement deterministic serializers**

Sort a copy by lowercase name and then profileUrl. CSV columns are exactly name, headline, profileUrl, connectedOn, collectedAt. Prefix cells beginning with equals, plus, minus, or at-sign with an apostrophe; double embedded quotes; quote every cell; join rows with CRLF; and prefix the document with a UTF-8 BOM. JSON is pretty-printed with two spaces and a trailing newline.

- [ ] **Step 4: Verify the task**

Run: npm run typecheck && npm test -- tests/export.test.ts

Expected: PASS, including commas, quotes, line breaks, null values, formula prefixes, sorting, and metadata.

- [ ] **Step 5: Commit when Git is available**

~~~bash
git add src/shared/export.ts tests/export.test.ts
git commit -m "feat: add safe connection exports"
~~~

---

### Task 4: Local Repository and Background Commands

**Files:**
- Create: src/background/storage.ts
- Create: src/background/index.ts
- Test: tests/storage.test.ts

**Interfaces:**
- Consumes: mergeRecords, serializeCsv, serializeJson, ExtensionMessage, ExtensionResponse
- Produces: ConnectionRepository with getSnapshot(), ingest(records), updateRun(patch), and clear()
- Produces: handleMessage(message, sender): Promise<ExtensionResponse>
- Storage keys: connections.v1 and run.v1

- [ ] **Step 1: Write failing repository tests**

~~~ts
import { expect, it } from "vitest";
import { ConnectionRepository } from "../src/background/storage";

it("persists merged records and counters", async () => {
  const area = createFakeStorageArea();
  const repository = new ConnectionRepository(area);
  await repository.ingest([{ name: "Ada", headline: null, profileUrl: "https://www.linkedin.com/in/ada", connectedOn: null, collectedAt: "2026-09-13T00:00:00.000Z" }]);
  const snapshot = await repository.getSnapshot();
  expect(snapshot.records).toHaveLength(1);
  expect(snapshot.run.totalUnique).toBe(1);
});

it("clears records and resets run metadata", async () => {
  const repository = new ConnectionRepository(createFakeStorageArea());
  await repository.clear();
  expect(await repository.getSnapshot()).toMatchObject({ records: [], run: { state: "idle", totalUnique: 0 } });
});
~~~

- [ ] **Step 2: Run tests and verify failure**

Run: npm test -- tests/storage.test.ts

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement storage with serialized updates**

ConnectionRepository receives the minimal Chrome storage area interface. Serialize ingest operations through a private promise queue so overlapping content-script messages cannot lose records. Return snapshots with defaults when keys are absent or malformed.

- [ ] **Step 4: Implement background command routing**

GET_SNAPSHOT reads storage. INGEST_RECORDS normalizes and merges candidates with one shared timestamp. UPDATE_RUN applies allowed run fields. START_COLLECTION, STOP_COLLECTION, and SCAN_VISIBLE forward to the active supported tab. CLEAR_DATA clears after the popup has confirmed. EXPORT_CSV and EXPORT_JSON create Blobs, object URLs, and chrome.downloads.download calls with timestamped filenames, then revoke URLs.

Every branch returns either { ok: true, data } or { ok: false, error: { code, message } }. Reject commands from unexpected senders and reject collection commands when the active tab URL is unsupported.

- [ ] **Step 5: Verify the task**

Run: npm run typecheck && npm test -- tests/storage.test.ts

Expected: PASS for default state, serialized ingestion, merging, state updates, and clearing.

- [ ] **Step 6: Commit when Git is available**

~~~bash
git add src/background tests/storage.test.ts
git commit -m "feat: persist connections and route extension commands"
~~~

---

### Task 5: Bounded Collector and Browser Adapter

**Files:**
- Create: src/content/collector.ts
- Create: src/content/index.ts
- Test: tests/collector.test.ts

**Interfaces:**
- Consumes: parseConnectionCards, detectCheckpoint, shared messages and settings
- Produces: runCollector(adapter: CollectorAdapter, settings: CollectorSettings, signal: AbortSignal): Promise<CollectorOutcome>
- CollectorAdapter methods: isVisible(), isSupported(), checkpoint(), scan(), ingest(candidates), metrics(), scrollByViewport(), waitForGrowth(previous, timeoutMs), updateRun(patch)
- CollectorOutcome stopReason values: user, record-limit, duration-limit, hidden-tab, unsupported-page, checkpoint, no-growth, parse-failure, unexpected

- [ ] **Step 1: Write failing state-machine tests**

~~~ts
import { expect, it, vi } from "vitest";
import { runCollector } from "../src/content/collector";

it("stops after consecutive no-growth cycles", async () => {
  const adapter = fakeAdapter({
    scans: [{ candidates: [ada], failures: 0, examined: 1 }, { candidates: [], failures: 0, examined: 1 }],
    growth: [false, false, false],
  });
  const result = await runCollector(adapter, { maxRecords: 100, maxDurationMs: 60_000, renderTimeoutMs: 50, maxNoGrowthCycles: 3, maxFailureRatioCycles: 2 }, new AbortController().signal);
  expect(result.stopReason).toBe("no-growth");
  expect(adapter.scrollByViewport).toHaveBeenCalledTimes(3);
});

it("stops immediately for a checkpoint without scrolling", async () => {
  const adapter = fakeAdapter({ checkpoint: "Security check" });
  const result = await runCollector(adapter, defaultSettings, new AbortController().signal);
  expect(result.stopReason).toBe("checkpoint");
  expect(adapter.scrollByViewport).not.toHaveBeenCalled();
});
~~~

- [ ] **Step 2: Run tests and verify failure**

Run: npm test -- tests/collector.test.ts

Expected: FAIL because the collector does not exist.

- [ ] **Step 3: Implement the pure collection loop**

Before every scan and scroll, check abort, visibility, supported route, checkpoint, elapsed duration, and total records. Ingest parsed candidates, accumulate new and duplicate counters from the response, and block after maxFailureRatioCycles consecutive scans where examined is greater than zero and failures divided by examined is at least 0.8.

Scroll by 0.8 viewport heights. waitForGrowth resolves when a MutationObserver sees relevant list growth or document height increases, otherwise after renderTimeoutMs. Count a no-growth cycle only when neither the document nor unique-record count grows. Use fixed bounded timing for rendering, never randomized timing.

- [ ] **Step 4: Implement the DOM and Chrome adapter**

Maintain one module-level AbortController. START_COLLECTION cancels any old run, creates a controller, marks collecting, and runs the collector. STOP_COLLECTION aborts it. SCAN_VISIBLE performs page, visibility, and checkpoint checks, parses once, and ingests once without scrolling. Listen for visibilitychange and abort immediately when hidden.

Convert all thrown errors to an unexpected blocked outcome, update run metadata, and retain stored data.

- [ ] **Step 5: Verify all stop conditions**

Run: npm run typecheck && npm test -- tests/collector.test.ts

Expected: PASS for user abort, hidden page, unsupported navigation, checkpoint, record limit, duration limit, no growth, high parse-failure ratio, and unexpected errors.

- [ ] **Step 6: Commit when Git is available**

~~~bash
git add src/content tests/collector.test.ts
git commit -m "feat: add bounded connections collector"
~~~

---

### Task 6: Popup, Integration, and Acceptance Verification

**Files:**
- Create: src/popup/index.html
- Create: src/popup/styles.css
- Create: src/popup/index.ts
- Test: tests/popup.test.ts
- Modify: scripts/build.mjs
- Modify: src/manifest.json
- Create: README.md

**Interfaces:**
- Consumes: GET_SNAPSHOT, START_COLLECTION, STOP_COLLECTION, SCAN_VISIBLE, CLEAR_DATA, EXPORT_CSV, and EXPORT_JSON messages
- Produces: renderSnapshot(root: HTMLElement, snapshot: ExtensionSnapshot): void
- Produces: built unpacked extension in dist

- [ ] **Step 1: Write failing popup tests**

~~~ts
import { expect, it } from "vitest";
import { renderSnapshot } from "../src/popup/index";

it("renders status, counters, and collecting controls", () => {
  document.body.innerHTML = popupFixture;
  renderSnapshot(document.body, {
    records: [],
    run: { state: "collecting", totalUnique: 12, addedThisRun: 4, duplicates: 2, parseFailures: 1, message: null },
  });
  expect(document.querySelector("[data-status]")?.textContent).toContain("Collecting");
  expect(document.querySelector("[data-total]")?.textContent).toBe("12");
  expect((document.querySelector("[data-start]") as HTMLButtonElement).disabled).toBe(true);
  expect((document.querySelector("[data-stop]") as HTMLButtonElement).disabled).toBe(false);
});
~~~

- [ ] **Step 2: Run tests and verify failure**

Run: npm test -- tests/popup.test.ts

Expected: FAIL because the popup files do not exist.

- [ ] **Step 3: Build the accessible popup**

Create a 360-pixel-wide popup with a status badge, four counters, numeric maximum-record and maximum-duration inputs, Start, Stop, and Scan visible controls, separate CSV and JSON export buttons, and a Clear data danger action. Associate every input with a label, expose status updates through aria-live=polite, keep keyboard focus visible, and avoid color-only state communication.

- [ ] **Step 4: Wire popup commands and confirmation**

Load GET_SNAPSHOT on DOMContentLoaded and after each command. Poll once per second only while state is collecting; stop polling in every other state. Validate limits client-side. Use window.confirm before CLEAR_DATA. Display background error messages in the live status region.

- [ ] **Step 5: Finish build configuration and documentation**

Ensure build copies HTML, CSS, and manifest and bundles background, content, and popup scripts to the filenames referenced by the manifest. README instructions must cover npm install, npm run check, loading dist through chrome://extensions in Developer mode, opening the Connections page, safe operation, exports, privacy, limitations, and removal.

- [ ] **Step 6: Run full automated verification**

Run: npm run check

Expected: TypeScript passes, all Vitest suites pass, and dist contains manifest.json, background.js, content.js, popup.html, popup.css, and popup.js.

- [ ] **Step 7: Perform manual unpacked-extension acceptance test**

1. Load the dist directory as an unpacked extension.
2. Confirm the popup rejects a non-Connections tab.
3. Open the Connections page and run Scan visible page.
4. Confirm fields, counters, persistence after popup closure, and deduplication after a second scan.
5. Start collection with small record and duration limits.
6. Confirm Stop works and collection stops when the tab becomes hidden.
7. Export both formats and compare record counts and field values.
8. Clear data and confirm the popup returns to zero idle state.
9. If LinkedIn presents a checkpoint, confirm collection blocks and does not interact with it.

- [ ] **Step 8: Commit when Git is available**

~~~bash
git add src/popup scripts/build.mjs src/manifest.json tests/popup.test.ts README.md
git commit -m "feat: complete LinkedIn connections collector MVP"
~~~
