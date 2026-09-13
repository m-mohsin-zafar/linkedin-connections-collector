import { describe, expect, it } from "vitest";
import {
  runCollector,
  type CollectorAdapter,
} from "../src/content/collector";
import type {
  CollectorSettings,
  ConnectionCandidate,
  ParseResult,
  RunState,
} from "../src/shared/types";

const ada: ConnectionCandidate = {
  name: "Ada",
  profileUrl: "https://www.linkedin.com/in/ada",
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
  nowValue = 0;
  totalUnique = 0;
  scrollCount = 0;
  updates: Partial<RunState>[] = [];
  scans: ParseResult[] = [];
  growth: boolean[] = [];

  now(): number {
    return this.nowValue++;
  }
  isVisible(): boolean {
    return this.visible;
  }
  isSupported(): boolean {
    return this.supported;
  }
  checkpoint(): string | null {
    return this.checkpointMessage;
  }
  async scan(): Promise<ParseResult> {
    return (
      this.scans.shift() ?? {
        candidates: [],
        failures: 0,
        examined: 0,
      }
    );
  }
  async ingest(candidates: ConnectionCandidate[]) {
    const added = candidates.length;
    this.totalUnique += added;
    return { added, duplicates: 0, totalUnique: this.totalUnique };
  }
  documentHeight(): number {
    return 1000 + this.scrollCount * 100;
  }
  scrollByViewport(): void {
    this.scrollCount += 1;
  }
  async waitForGrowth(): Promise<boolean> {
    return this.growth.shift() ?? false;
  }
  async updateRun(patch: Partial<RunState>): Promise<void> {
    this.updates.push(patch);
  }
}

describe("runCollector", () => {
  it("stops after the configured consecutive no-growth cycles", async () => {
    const adapter = new FakeCollectorAdapter();
    adapter.scans = [
      { candidates: [ada], failures: 0, examined: 1 },
      { candidates: [], failures: 0, examined: 1 },
      { candidates: [], failures: 0, examined: 1 },
      { candidates: [], failures: 0, examined: 1 },
    ];
    adapter.growth = [false, false, false, false];

    const result = await runCollector(
      adapter,
      settings,
      new AbortController().signal,
    );

    expect(result.stopReason).toBe("no-growth");
    expect(adapter.scrollCount).toBe(4);
    expect(adapter.updates.at(-1)).toMatchObject({
      state: "completed",
      stopReason: "no-growth",
    });
  });

  it("blocks immediately for a checkpoint without scanning or scrolling", async () => {
    const adapter = new FakeCollectorAdapter();
    adapter.checkpointMessage = "Verification checkpoint detected";

    const result = await runCollector(
      adapter,
      settings,
      new AbortController().signal,
    );

    expect(result.stopReason).toBe("checkpoint");
    expect(adapter.scrollCount).toBe(0);
    expect(adapter.updates.at(-1)).toMatchObject({
      state: "blocked",
      message: "Verification checkpoint detected",
    });
  });

  it("pauses when the tab is hidden", async () => {
    const adapter = new FakeCollectorAdapter();
    adapter.visible = false;

    const result = await runCollector(
      adapter,
      settings,
      new AbortController().signal,
    );
    expect(result.stopReason).toBe("hidden-tab");
    expect(adapter.updates.at(-1)?.state).toBe("paused");
  });

  it("stops at the record limit after preserving the ingested batch", async () => {
    const adapter = new FakeCollectorAdapter();
    adapter.scans = [
      {
        candidates: [ada, { name: "Grace", profileUrl: "/in/grace" }],
        failures: 0,
        examined: 2,
      },
    ];

    const result = await runCollector(
      adapter,
      { ...settings, maxRecords: 2 },
      new AbortController().signal,
    );
    expect(result.stopReason).toBe("record-limit");
    expect(adapter.totalUnique).toBe(2);
    expect(adapter.scrollCount).toBe(0);
  });

  it("blocks after repeated broad parsing failures", async () => {
    const adapter = new FakeCollectorAdapter();
    adapter.scans = [
      { candidates: [], failures: 4, examined: 4 },
      { candidates: [], failures: 4, examined: 5 },
    ];
    adapter.growth = [true];

    const result = await runCollector(
      adapter,
      settings,
      new AbortController().signal,
    );
    expect(result.stopReason).toBe("parse-failure");
    expect(adapter.updates.at(-1)?.state).toBe("blocked");
  });

  it("stops when aborted by the user", async () => {
    const adapter = new FakeCollectorAdapter();
    const controller = new AbortController();
    controller.abort();

    const result = await runCollector(adapter, settings, controller.signal);
    expect(result.stopReason).toBe("user");
    expect(adapter.updates.at(-1)?.state).toBe("completed");
  });

  it("preserves a hidden-tab reason supplied by the browser controller", async () => {
    const adapter = new FakeCollectorAdapter();
    const controller = new AbortController();
    controller.abort("hidden-tab");

    const result = await runCollector(adapter, settings, controller.signal);
    expect(result.stopReason).toBe("hidden-tab");
    expect(adapter.updates.at(-1)?.state).toBe("paused");
  });
});
