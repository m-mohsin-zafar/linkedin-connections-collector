import type {
  CollectorSettings,
  ConnectionCandidate,
  ParseResult,
  RunState,
  RunStatus,
  StopReason,
} from "../shared/types";

export interface IngestResult {
  added: number;
  duplicates: number;
  totalUnique: number;
}

export interface CollectorAdapter {
  now(): number;
  isVisible(): boolean;
  isSupported(): boolean;
  checkpoint(): string | null;
  scan(): Promise<ParseResult>;
  ingest(candidates: ConnectionCandidate[]): Promise<IngestResult>;
  documentHeight(): number;
  scrollByViewport(): void;
  waitForGrowth(
    previousHeight: number,
    timeoutMs: number,
  ): Promise<boolean>;
  updateRun(patch: Partial<RunState>): Promise<void>;
}

export interface CollectorOutcome {
  stopReason: StopReason;
  message: string;
}

const OUTCOMES: Record<
  StopReason,
  { state: RunStatus; message: string }
> = {
  user: { state: "completed", message: "Collection stopped by you." },
  "record-limit": {
    state: "completed",
    message: "The record limit was reached.",
  },
  "duration-limit": {
    state: "completed",
    message: "The duration limit was reached.",
  },
  "hidden-tab": {
    state: "paused",
    message: "Collection paused because the tab is hidden.",
  },
  "unsupported-page": {
    state: "blocked",
    message: "Collection stopped because the page is no longer supported.",
  },
  checkpoint: {
    state: "blocked",
    message: "LinkedIn displayed a verification checkpoint.",
  },
  "no-growth": {
    state: "completed",
    message: "No more rendered connections were found.",
  },
  "up-to-date": {
    state: "completed",
    message: "All new connections have been collected.",
  },
  "cursor-not-found": {
    state: "blocked",
    message: "The previous refresh marker was not found.",
  },
  "account-changed": {
    state: "blocked",
    message: "The signed-in LinkedIn account changed during collection.",
  },
  "parse-failure": {
    state: "blocked",
    message: "The page layout could not be read reliably.",
  },
  unexpected: {
    state: "blocked",
    message: "Collection stopped because of an unexpected error.",
  },
};

async function finish(
  adapter: CollectorAdapter,
  stopReason: StopReason,
  message?: string,
): Promise<CollectorOutcome> {
  const outcome = OUTCOMES[stopReason];
  const finalMessage = message ?? outcome.message;
  await adapter.updateRun({
    state: outcome.state,
    stopReason,
    message: finalMessage,
  });
  return { stopReason, message: finalMessage };
}

export async function runCollector(
  adapter: CollectorAdapter,
  settings: CollectorSettings,
  signal: AbortSignal,
): Promise<CollectorOutcome> {
  const startedAt = adapter.now();
  let noGrowthCycles = 0;
  let failureRatioCycles = 0;
  let parseFailures = 0;
  let totalUnique = 0;

  await adapter.updateRun({
    state: "collecting",
    addedThisRun: 0,
    duplicates: 0,
    parseFailures: 0,
    message: "Collecting rendered connections…",
    startedAt: new Date().toISOString(),
    stopReason: null,
  });

  try {
    while (true) {
      if (signal.aborted) {
        const reason =
          signal.reason === "hidden-tab" ? "hidden-tab" : "user";
        return await finish(adapter, reason);
      }
      if (!adapter.isVisible()) {
        return await finish(adapter, "hidden-tab");
      }
      if (!adapter.isSupported()) {
        return await finish(adapter, "unsupported-page");
      }

      const checkpoint = adapter.checkpoint();
      if (checkpoint) {
        return await finish(adapter, "checkpoint", checkpoint);
      }
      if (adapter.now() - startedAt >= settings.maxDurationMs) {
        return await finish(adapter, "duration-limit");
      }

      const parsed = await adapter.scan();
      parseFailures += parsed.failures;
      const ingest = await adapter.ingest(parsed.candidates);
      totalUnique = ingest.totalUnique;
      await adapter.updateRun({ parseFailures });

      if (totalUnique >= settings.maxRecords) {
        return await finish(adapter, "record-limit");
      }

      const broadFailure =
        parsed.examined > 0 &&
        parsed.failures / parsed.examined >= 0.8;
      failureRatioCycles = broadFailure ? failureRatioCycles + 1 : 0;
      if (failureRatioCycles >= settings.maxFailureRatioCycles) {
        return await finish(adapter, "parse-failure");
      }

      const previousHeight = adapter.documentHeight();
      adapter.scrollByViewport();
      const grew = await adapter.waitForGrowth(
        previousHeight,
        settings.renderTimeoutMs,
      );
      noGrowthCycles =
        !grew && ingest.added === 0 ? noGrowthCycles + 1 : 0;
      if (noGrowthCycles >= settings.maxNoGrowthCycles) {
        return await finish(adapter, "no-growth");
      }
    }
  } catch (caught) {
    const message =
      caught instanceof Error
        ? "Collection failed: " + caught.message
        : undefined;
    return await finish(adapter, "unexpected", message);
  }
}
