# Per-Account Incremental Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Isolate connection datasets by signed-in LinkedIn account and stop refresh runs at the last successfully saved newest connection.

**Architecture:** The content script detects the signed-in account from semantic global-navigation markup. The background resolves that identity before every user command and scopes storage to an accounts.v2 map. The collector snapshots the prior cursor, ingests newest-first batches, and promotes a candidate cursor only after a provably successful initial or incremental run.

**Tech Stack:** TypeScript, Chrome Extensions Manifest V3, vanilla HTML/CSS, Vitest, jsdom

**Spec:** docs/superpowers/specs/2026-09-13-per-account-incremental-refresh-design.md

## Global Constraints

- The account key is the signed-in member's canonical LinkedIn profile URL.
- Never guess an account or merge two accounts' records.
- Connection dates are display data, never refresh cursors.
- Promote a cursor only after reaching the previous cursor, or after initial collection reaches no-growth.
- Every interrupted, limited, blocked, or failed run retains the previous cursor.
- Existing connections.v1 and run.v1 data stays untouched and is not assigned automatically.
- Export and clear operate only on the currently detected account.

---

## File Structure

- src/shared/types.ts: account identity, account dataset, collection context, stop reasons, and enriched messages
- src/content/account.ts: semantic signed-in account detection
- src/content/collector.ts: cursor selection, stop detection, and successful promotion
- src/content/index.ts: account-resolution command and account-aware browser adapter
- src/background/storage.ts: accounts.v2 repository and per-account serialized writes
- src/background/index.ts: active-account resolution and current-account command routing
- src/popup/index.html: account, mode, and last-refresh fields
- src/popup/index.ts: account-aware snapshot rendering
- src/popup/styles.css: compact account-context styles
- tests/account.test.ts: account detection
- tests/storage.test.ts: account isolation and cursor persistence
- tests/background.test.ts: context resolution and scoped export/clear
- tests/collector.test.ts: cursor lifecycle
- tests/content.test.ts: account-aware controller behavior
- tests/popup.test.ts: account/mode presentation
- README.md: incremental refresh behavior and storage boundary

---

### Task 1: Signed-In Account Identity

**Files:**
- Modify: src/shared/types.ts
- Create: src/content/account.ts
- Create: tests/account.test.ts
- Modify: tests/parser.test.ts

**Interfaces:**
- Produces: AccountIdentity = { accountKey: string; displayName: string | null }
- Produces: AccountIdentityResult = { identity: AccountIdentity | null; reason: string | null }
- Produces: detectAccountIdentity(document: Document): AccountIdentityResult
- Consumes: canonicalizeProfileUrl(value: string): string | null

- [ ] **Step 1: Write failing account-detection tests**

~~~ts
it("detects one signed-in member from the Me navigation item", () => {
  document.body.innerHTML = [
    '<nav aria-label="Primary Navigation">',
    '<div aria-label="Me"><a href="/in/owner/?trk=nav">',
    '<img alt="Amina Khan"><span>Me</span></a></div>',
    "</nav>",
    '<main><a href="/in/connection/">A Connection</a></main>',
  ].join("");
  expect(detectAccountIdentity(document)).toEqual({
    identity: {
      accountKey: "https://www.linkedin.com/in/owner",
      displayName: "Amina Khan",
    },
    reason: null,
  });
});

it("rejects missing or ambiguous signed-in member links", () => {
  document.body.innerHTML = '<main><a href="/in/connection/">Connection</a></main>';
  expect(detectAccountIdentity(document).identity).toBeNull();
  document.body.innerHTML =
    '<nav><div aria-label="Me"><a href="/in/a/">Me</a><a href="/in/b/">Me</a></div></nav>';
  expect(detectAccountIdentity(document).reason).toMatch(/ambiguous/i);
});
~~~

- [ ] **Step 2: Verify the tests fail**

Run: npm test -- tests/account.test.ts

Expected: FAIL because src/content/account.ts does not exist.

- [ ] **Step 3: Add account and context types**

~~~ts
export interface AccountIdentity {
  accountKey: string;
  displayName: string | null;
}

export interface AccountDataset extends AccountIdentity {
  records: ConnectionRecord[];
  refreshCursor: string | null;
  lastCompletedAt: string | null;
  run: RunState;
}

export interface CollectionContext {
  account: AccountIdentity;
  previousCursor: string | null;
}
~~~

Add up-to-date, cursor-not-found, and account-changed to StopReason. Extend ExtensionSnapshot with account, refreshCursor, and lastCompletedAt.

- [ ] **Step 4: Implement semantic account detection**

Search only nav and header regions. Candidate containers must expose Me through aria-label, title, or compact visible text. Within those containers, collect unique canonical /in/ profile links. Return the identity only when exactly one unique profile URL remains. Derive displayName from the profile image alt or accessible link label after removing Me and profile boilerplate; use null when it is not reliable.

- [ ] **Step 5: Verify the task**

Run: npm run typecheck && npm test -- tests/account.test.ts tests/parser.test.ts

Expected: PASS for one owner, connection-link exclusion, missing identity, ambiguity, relative URL normalization, and optional display name.

- [ ] **Step 6: Commit**

~~~bash
git add src/shared/types.ts src/content/account.ts tests/account.test.ts tests/parser.test.ts
git commit -m "feat: detect signed-in LinkedIn account"
~~~

---

### Task 2: Versioned Per-Account Repository

**Files:**
- Modify: src/background/storage.ts
- Modify: tests/storage.test.ts

**Interfaces:**
- Produces: getSnapshot(account: AccountIdentity): Promise<ExtensionSnapshot>
- Produces: ingest(accountKey: string, records: ConnectionRecord[]): Promise<MergeResult>
- Produces: updateRun(accountKey: string, patch: Partial<RunState>): Promise<RunState>
- Produces: promoteCursor(accountKey: string, cursor: string, completedAt: string): Promise<void>
- Produces: clear(accountKey: string): Promise<void>
- Storage key: accounts.v2

- [ ] **Step 1: Replace global repository expectations with failing account tests**

~~~ts
it("isolates records and counters for two accounts", async () => {
  const repository = new ConnectionRepository(new FakeStorageArea());
  await repository.ingest(ownerA.accountKey, [ada]);
  await repository.ingest(ownerB.accountKey, [grace]);
  expect((await repository.getSnapshot(ownerA)).records).toEqual([ada]);
  expect((await repository.getSnapshot(ownerB)).records).toEqual([grace]);
});

it("promotes and preserves a cursor per account", async () => {
  const repository = new ConnectionRepository(new FakeStorageArea());
  await repository.getSnapshot(ownerA);
  await repository.promoteCursor(
    ownerA.accountKey,
    "https://www.linkedin.com/in/ada",
    "2026-09-13T12:00:00.000Z",
  );
  expect(await repository.getSnapshot(ownerA)).toMatchObject({
    refreshCursor: "https://www.linkedin.com/in/ada",
    lastCompletedAt: "2026-09-13T12:00:00.000Z",
  });
});

it("clears only the addressed account and leaves version-one keys untouched", async () => {
  const area = new FakeStorageArea({
    "connections.v1": [ada],
    "run.v1": { state: "completed" },
  });
  const repository = new ConnectionRepository(area);
  await repository.ingest(ownerA.accountKey, [ada]);
  await repository.ingest(ownerB.accountKey, [grace]);
  await repository.clear(ownerA.accountKey);
  expect((await repository.getSnapshot(ownerA)).records).toEqual([]);
  expect((await repository.getSnapshot(ownerB)).records).toEqual([grace]);
  expect(await area.get(["connections.v1", "run.v1"])).toEqual({
    "connections.v1": [ada],
    "run.v1": { state: "completed" },
  });
});
~~~

- [ ] **Step 2: Verify the tests fail for the old global API**

Run: npm test -- tests/storage.test.ts

Expected: FAIL because repository methods do not accept or isolate account keys.

- [ ] **Step 3: Implement accounts.v2 validation and defaults**

Store Record<string, AccountDataset> under accounts.v2. Validate every account key with canonicalizeProfileUrl and require it to equal its canonical form. getSnapshot creates an in-memory default with empty records, null cursor and completion time, and EMPTY_RUN_STATE without writing until a mutation occurs.

- [ ] **Step 4: Implement serialized account mutations**

Keep the existing single promise queue, read the complete accounts map inside each queued mutation, update only accounts[accountKey], and write the complete map once. ingest merges only that account's records. updateRun recomputes totalUnique from that account's records. promoteCursor rejects a noncanonical cursor. clear deletes only accounts[accountKey].

- [ ] **Step 5: Verify the task**

Run: npm run typecheck && npm test -- tests/storage.test.ts

Expected: PASS for isolation, simultaneous ingestion, cursor promotion, current-account clear, invalid keys, defaults, and untouched version 1 data.

- [ ] **Step 6: Commit**

~~~bash
git add src/background/storage.ts tests/storage.test.ts
git commit -m "feat: isolate connection data by account"
~~~

---

### Task 3: Cursor-Aware Collection State Machine

**Files:**
- Modify: src/content/collector.ts
- Modify: tests/collector.test.ts

**Interfaces:**
- Changes: runCollector(adapter, settings, context, signal): Promise<CollectorOutcome>
- Changes: adapter.ingest(accountKey, candidates)
- Changes: adapter.updateRun(accountKey, patch)
- Adds: adapter.currentAccountKey(): string | null
- Adds: adapter.promoteCursor(accountKey, cursor, completedAt): Promise<void>
- Consumes: CollectionContext and canonicalizeProfileUrl

- [ ] **Step 1: Write failing incremental-refresh tests**

~~~ts
it("ingests the cursor batch, promotes the newest item, and stops without scrolling", async () => {
  const adapter = new FakeCollectorAdapter();
  adapter.scans = [{
    candidates: [newest, oldCursor],
    failures: 0,
    examined: 2,
  }];
  const result = await runCollector(
    adapter,
    settings,
    { account: ownerA, previousCursor: oldCursor.profileUrl },
    new AbortController().signal,
  );
  expect(result.stopReason).toBe("up-to-date");
  expect(adapter.ingested).toEqual([newest, oldCursor]);
  expect(adapter.promotions).toEqual([{
    accountKey: ownerA.accountKey,
    cursor: newest.profileUrl,
  }]);
  expect(adapter.scrollCount).toBe(0);
});

it("promotes the first item after an initial collection reaches no-growth", async () => {
  const adapter = new FakeCollectorAdapter();
  adapter.scans = [
    { candidates: [newest], failures: 0, examined: 1 },
    { candidates: [], failures: 0, examined: 0 },
    { candidates: [], failures: 0, examined: 0 },
    { candidates: [], failures: 0, examined: 0 },
  ];
  adapter.growth = [false, false, false, false];
  const result = await runCollector(
    adapter,
    settings,
    { account: ownerA, previousCursor: null },
    new AbortController().signal,
  );
  expect(result.stopReason).toBe("no-growth");
  expect(adapter.promotions[0]?.cursor).toBe(newest.profileUrl);
});

it("does not promote when the user interrupts a refresh", async () => {
  const adapter = new FakeCollectorAdapter();
  adapter.scans = [{
    candidates: [newest],
    failures: 0,
    examined: 1,
  }];
  const controller = new AbortController();
  controller.abort("user");
  await runCollector(
    adapter,
    settings,
    { account: ownerA, previousCursor: oldCursor.profileUrl },
    controller.signal,
  );
  expect(adapter.promotions).toEqual([]);
});

// Add expect(adapter.promotions).toEqual([]) to the existing hidden-tab,
// record-limit, duration-limit, checkpoint, parse-failure, and unexpected
// stop tests. Each existing fixture already reaches its named stop branch.

it("blocks when no-growth occurs before an existing cursor is found", async () => {
  const adapter = new FakeCollectorAdapter();
  adapter.scans = [
    { candidates: [newest], failures: 0, examined: 1 },
    { candidates: [], failures: 0, examined: 0 },
    { candidates: [], failures: 0, examined: 0 },
    { candidates: [], failures: 0, examined: 0 },
  ];
  adapter.growth = [false, false, false, false];
  const result = await runCollector(
    adapter,
    settings,
    { account: ownerA, previousCursor: oldCursor.profileUrl },
    new AbortController().signal,
  );
  expect(result.stopReason).toBe("cursor-not-found");
  expect(adapter.promotions).toEqual([]);
});
~~~

- [ ] **Step 2: Verify cursor tests fail**

Run: npm test -- tests/collector.test.ts

Expected: FAIL because runCollector has no context or cursor lifecycle.

- [ ] **Step 3: Implement candidate and previous-cursor tracking**

Before ingestion, canonicalize batch profile URLs. Set candidateCursor once from the first valid URL in the run. Always ingest the full batch. If previousCursor is present in that batch, promote candidateCursor when it differs from previousCursor, otherwise retain the same cursor while updating lastCompletedAt; then finish with up-to-date before scrolling.

- [ ] **Step 4: Implement safe completion and account-change rules**

Call currentAccountKey before each scan and after every render wait. Stop account-changed when it differs from context.account.accountKey. At no-growth, promote candidateCursor only when previousCursor is null. When previousCursor is non-null, finish cursor-not-found as Blocked without promotion. No other finish branch calls promoteCursor.

- [ ] **Step 5: Verify all cursor lifecycle behavior**

Run: npm run typecheck && npm test -- tests/collector.test.ts

Expected: PASS for immediate cursor hit, later cursor hit, full cursor-batch ingestion, initial promotion, cursor-not-found, account changes, and every non-promotion stop.

- [ ] **Step 6: Commit**

~~~bash
git add src/content/collector.ts tests/collector.test.ts
git commit -m "feat: stop refreshes at saved connection cursor"
~~~

---

### Task 4: Resolve Context and Scope Commands

**Files:**
- Modify: src/shared/types.ts
- Modify: src/content/index.ts
- Modify: src/background/index.ts
- Modify: tests/content.test.ts
- Modify: tests/background.test.ts

**Interfaces:**
- Adds message: GET_ACCOUNT_IDENTITY
- Enriches START_COLLECTION and SCAN_VISIBLE with optional CollectionContext for background-to-content delivery
- Enriches INGEST_RECORDS and UPDATE_RUN with accountKey
- Adds message: PROMOTE_CURSOR with accountKey, cursor, and completedAt
- Background helper: resolveActiveContext(): Promise<CollectionContext>

- [ ] **Step 1: Write failing background context tests**

~~~ts
it("resolves the active identity and returns only its snapshot", async () => {
  sendToTab.mockResolvedValueOnce({ ok: true, data: ownerA });
  const response = await handler()({ type: "GET_SNAPSHOT" });
  expect(response).toMatchObject({
    ok: true,
    data: { account: ownerA, records: [] },
  });
});

it("enriches start with the saved cursor", async () => {
  await repository.promoteCursor(ownerA.accountKey, oldCursor.profileUrl, now);
  sendToTab.mockResolvedValueOnce({ ok: true, data: ownerA });
  sendToTab.mockResolvedValueOnce({ ok: true });
  await handler()({ type: "START_COLLECTION", settings });
  expect(sendToTab.mock.calls[1]?.[1]).toMatchObject({
    type: "START_COLLECTION",
    context: { account: ownerA, previousCursor: oldCursor.profileUrl },
  });
});

it("exports and clears only the resolved account", async () => {
  await repository.ingest(ownerA.accountKey, [ada]);
  await repository.ingest(ownerB.accountKey, [grace]);
  sendToTab.mockResolvedValue({ ok: true, data: ownerA });
  await handler()({ type: "EXPORT_JSON" });
  expect(download.mock.calls[0]?.[0].content).toContain('"Ada"');
  expect(download.mock.calls[0]?.[0].content).not.toContain('"Grace"');
  await handler()({ type: "CLEAR_DATA" });
  expect((await repository.getSnapshot(ownerB)).records).toEqual([grace]);
});
~~~

- [ ] **Step 2: Verify background tests fail**

Run: npm test -- tests/background.test.ts tests/content.test.ts

Expected: FAIL because messages and handlers are global.

- [ ] **Step 3: Implement content identity and scoped adapter messages**

GET_ACCOUNT_IDENTITY returns detectAccountIdentity(document), failing with unsupported-page when identity is unavailable. START_COLLECTION and SCAN_VISIBLE reject a missing context. Browser adapter ingestion, run updates, and cursor promotion attach context.account.accountKey. currentAccountKey reruns detection and returns its canonical key or null.

- [ ] **Step 4: Implement background active-context resolution**

For GET_SNAPSHOT, START_COLLECTION, SCAN_VISIBLE, EXPORT_CSV, EXPORT_JSON, and CLEAR_DATA: validate the active Connections tab, send GET_ACCOUNT_IDENTITY, validate the returned canonical account key, and load that account's snapshot. Enrich collection commands with CollectionContext. INGEST_RECORDS, UPDATE_RUN, and PROMOTE_CURSOR call their exact repository methods.

- [ ] **Step 5: Verify scoped routing**

Run: npm run typecheck && npm test -- tests/background.test.ts tests/content.test.ts

Expected: PASS for missing identity, invalid identity, account-aware start and scan, scoped ingestion, promotion, exports, and clear.

- [ ] **Step 6: Commit**

~~~bash
git add src/shared/types.ts src/content/index.ts src/background/index.ts tests/content.test.ts tests/background.test.ts
git commit -m "feat: scope extension commands to active account"
~~~

---

### Task 5: Account-Aware Popup and Documentation

**Files:**
- Modify: src/popup/index.html
- Modify: src/popup/index.ts
- Modify: src/popup/styles.css
- Modify: tests/popup.test.ts
- Modify: README.md

**Interfaces:**
- Consumes: ExtensionSnapshot.account, refreshCursor, and lastCompletedAt
- Renders: detected account label, Initial collection or Refresh mode, and last completed time

- [ ] **Step 1: Write failing popup rendering tests**

~~~ts
it("renders the detected account and refresh state", () => {
  renderSnapshot(document.body, {
    account: ownerA,
    records: [ada],
    refreshCursor: ada.profileUrl,
    lastCompletedAt: "2026-09-13T12:00:00.000Z",
    run: idleRun,
  });
  expect(document.querySelector("[data-account]")?.textContent).toBe("Amina Khan");
  expect(document.querySelector("[data-mode]")?.textContent).toBe("Refresh mode");
  expect(document.querySelector("[data-last-refresh]")?.textContent).toMatch(/Sep/);
});

it("labels an account without a cursor as an initial collection", () => {
  renderSnapshot(document.body, {
    account: ownerA,
    records: [],
    refreshCursor: null,
    lastCompletedAt: null,
    run: idleRun,
  });
  expect(document.querySelector("[data-mode]")?.textContent).toBe("Initial collection");
  expect(document.querySelector("[data-last-refresh]")?.textContent).toBe("Never");
});
~~~

- [ ] **Step 2: Verify popup tests fail**

Run: npm test -- tests/popup.test.ts

Expected: FAIL because account context is not rendered.

- [ ] **Step 3: Add compact account context UI**

Add a semantic context row beneath the header with Account, Mode, and Last refreshed values. Use the existing typography, dividers, and color tokens. Prefer displayName; fall back to the canonical profile slug. Format lastCompletedAt with Intl.DateTimeFormat using the browser locale and short date plus short time.

- [ ] **Step 4: Update documentation**

Explain per-account isolation, initial collection, newest-first refresh stopping at the saved marker, cursor promotion only after success, cursor-not-found behavior, version 1 preservation, and current-account export and clear.

- [ ] **Step 5: Run complete verification**

Run: npm run check

Expected: strict typecheck passes, all tests pass, and dist contains a valid Manifest V3 extension with background.js, content.js, popup.html, popup.css, and popup.js.

- [ ] **Step 6: Commit**

~~~bash
git add src/popup tests/popup.test.ts README.md
git commit -m "feat: show account refresh context"
~~~
