import { describe, expect, it } from "vitest";
import { runCollector, type CollectorAdapter } from "../src/content/collector";
import type {
  AccountIdentity,
  CollectionContext,
  CollectorSettings,
  ConnectionCandidate,
  ParseResult,
  RunState,
} from "../src/shared/types";

const owner: AccountIdentity = {
  accountKey: "https://www.linkedin.com/in/owner",
  displayName: "Owner",
};
const initialContext: CollectionContext = { account: owner, previousCursor: null };
const ada: ConnectionCandidate = {
  name: "Ada",
  profileUrl: "https://www.linkedin.com/in/ada",
};
const grace: ConnectionCandidate = {
  name: "Grace",
  profileUrl: "https://www.linkedin.com/in/grace",
};
const settings: CollectorSettings = {
  maxRecords: 100,
  maxDurationMs: 60_000,
  renderTimeoutMs: 5,
  maxNoGrowthCycles: 3,
  maxFailureRatioCycles: 2,
};

class FakeCollectorAdapter implements CollectorAdapter {
  visible = true;
  supported = true;
  checkpointMessage: string | null = null;
  accountKey: string | null = owner.accountKey;
  nowValue = 1_780_000_000_000;
  totalUnique = 0;
  scrollCount = 0;
  updates: Array<{ accountKey: string; patch: Partial<RunState> }> = [];
  scans: ParseResult[] = [];
  growth: boolean[] = [];
  ingested: ConnectionCandidate[][] = [];
  promotions: Array<{ accountKey: string; cursor: string; completedAt: string }> = [];

  now(): number { return this.nowValue++; }
  isVisible(): boolean { return this.visible; }
  isSupported(): boolean { return this.supported; }
  checkpoint(): string | null { return this.checkpointMessage; }
  currentAccountKey(): string | null { return this.accountKey; }
  async scan(): Promise<ParseResult> {
    return this.scans.shift() ?? { candidates: [], failures: 0, examined: 0 };
  }
  async ingest(accountKey: string, candidates: ConnectionCandidate[]) {
    expect(accountKey).toBe(owner.accountKey);
    this.ingested.push(candidates);
    this.totalUnique += candidates.length;
    return { added: candidates.length, duplicates: 0, totalUnique: this.totalUnique };
  }
  documentHeight(): number { return 1000 + this.scrollCount * 100; }
  scrollByViewport(): void { this.scrollCount += 1; }
  async waitForGrowth(): Promise<boolean> { return this.growth.shift() ?? false; }
  async updateRun(accountKey: string, patch: Partial<RunState>): Promise<void> {
    this.updates.push({ accountKey, patch });
  }
  async promoteCursor(accountKey: string, cursor: string, completedAt: string) {
    this.promotions.push({ accountKey, cursor, completedAt });
  }
}

describe("runCollector", () => {
  it("promotes the first valid connection only after initial no-growth completion", async () => {
    const adapter = new FakeCollectorAdapter();
    adapter.scans = [
      { candidates: [ada], failures: 0, examined: 1 },
      { candidates: [], failures: 0, examined: 0 },
      { candidates: [], failures: 0, examined: 0 },
      { candidates: [], failures: 0, examined: 0 },
    ];

    const result = await runCollector(
      adapter, settings, initialContext, new AbortController().signal,
    );

    expect(result.stopReason).toBe("no-growth");
    expect(adapter.promotions[0]).toMatchObject({
      accountKey: owner.accountKey,
      cursor: ada.profileUrl,
    });
    expect(adapter.scrollCount).toBe(4);
  });

  it("ingests the cursor batch, promotes its newest item, and stops without scrolling", async () => {
    const adapter = new FakeCollectorAdapter();
    adapter.scans = [{ candidates: [grace, ada], failures: 0, examined: 2 }];

    const result = await runCollector(
      adapter,
      settings,
      { account: owner, previousCursor: ada.profileUrl },
      new AbortController().signal,
    );

    expect(result.stopReason).toBe("up-to-date");
    expect(adapter.ingested).toEqual([[grace, ada]]);
    expect(adapter.promotions[0]).toMatchObject({ cursor: grace.profileUrl });
    expect(adapter.scrollCount).toBe(0);
  });

  it("blocks and retains the previous cursor when no-growth never finds it", async () => {
    const adapter = new FakeCollectorAdapter();
    adapter.scans = [
      { candidates: [grace], failures: 0, examined: 1 },
      { candidates: [], failures: 0, examined: 0 },
      { candidates: [], failures: 0, examined: 0 },
      { candidates: [], failures: 0, examined: 0 },
    ];

    const result = await runCollector(
      adapter,
      settings,
      { account: owner, previousCursor: ada.profileUrl },
      new AbortController().signal,
    );

    expect(result.stopReason).toBe("cursor-not-found");
    expect(adapter.promotions).toEqual([]);
    expect(adapter.updates.at(-1)?.patch.state).toBe("blocked");
  });

  it("blocks before ingesting when the signed-in account changes", async () => {
    const adapter = new FakeCollectorAdapter();
    adapter.accountKey = "https://www.linkedin.com/in/someone-else";
    const result = await runCollector(
      adapter, settings, initialContext, new AbortController().signal,
    );
    expect(result.stopReason).toBe("account-changed");
    expect(adapter.ingested).toEqual([]);
  });

  it("does not promote a cursor when a configured limit interrupts collection", async () => {
    const adapter = new FakeCollectorAdapter();
    adapter.scans = [{ candidates: [ada, grace], failures: 0, examined: 2 }];
    const result = await runCollector(
      adapter,
      { ...settings, maxRecords: 2 },
      initialContext,
      new AbortController().signal,
    );
    expect(result.stopReason).toBe("record-limit");
    expect(adapter.promotions).toEqual([]);
  });

  it("blocks immediately for a checkpoint without scanning", async () => {
    const adapter = new FakeCollectorAdapter();
    adapter.checkpointMessage = "Verification checkpoint detected";
    const result = await runCollector(
      adapter, settings, initialContext, new AbortController().signal,
    );
    expect(result.stopReason).toBe("checkpoint");
    expect(adapter.ingested).toEqual([]);
  });

  it("pauses when the tab is hidden", async () => {
    const adapter = new FakeCollectorAdapter();
    adapter.visible = false;
    const result = await runCollector(
      adapter, settings, initialContext, new AbortController().signal,
    );
    expect(result.stopReason).toBe("hidden-tab");
    expect(adapter.updates.at(-1)?.patch.state).toBe("paused");
  });

  it("blocks after repeated broad parsing failures", async () => {
    const adapter = new FakeCollectorAdapter();
    adapter.scans = [
      { candidates: [], failures: 4, examined: 4 },
      { candidates: [], failures: 4, examined: 5 },
    ];
    adapter.growth = [true];
    const result = await runCollector(
      adapter, settings, initialContext, new AbortController().signal,
    );
    expect(result.stopReason).toBe("parse-failure");
    expect(adapter.promotions).toEqual([]);
  });

  it("stops when aborted by the user without promoting", async () => {
    const adapter = new FakeCollectorAdapter();
    const controller = new AbortController();
    controller.abort();
    const result = await runCollector(adapter, settings, initialContext, controller.signal);
    expect(result.stopReason).toBe("user");
    expect(adapter.promotions).toEqual([]);
  });
});
