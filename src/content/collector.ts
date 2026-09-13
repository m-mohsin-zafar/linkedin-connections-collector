import { canonicalizeProfileUrl } from "../shared/records";
import type {
  CollectionContext,
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
  currentAccountKey(): string | null;
  scan(): Promise<ParseResult>;
  ingest(accountKey: string, candidates: ConnectionCandidate[]): Promise<IngestResult>;
  documentHeight(): number;
  scrollByViewport(): void;
  waitForGrowth(previousHeight: number, timeoutMs: number): Promise<boolean>;
  updateRun(accountKey: string, patch: Partial<RunState>): Promise<void>;
  promoteCursor(accountKey: string, cursor: string, completedAt: string): Promise<void>;
}

export interface CollectorOutcome {
  stopReason: StopReason;
  message: string;
}

const OUTCOMES: Record<StopReason, { state: RunStatus; message: string }> = {
  user: { state: "completed", message: "Collection stopped by you." },
  "record-limit": { state: "completed", message: "The record limit was reached." },
  "duration-limit": { state: "completed", message: "The duration limit was reached." },
  "hidden-tab": { state: "paused", message: "Collection paused because the tab is hidden." },
  "unsupported-page": { state: "blocked", message: "Collection stopped because the page is no longer supported." },
  checkpoint: { state: "blocked", message: "LinkedIn displayed a verification checkpoint." },
  "no-growth": { state: "completed", message: "Initial collection completed." },
  "up-to-date": { state: "completed", message: "All new connections have been collected." },
  "cursor-not-found": { state: "blocked", message: "The previous refresh marker was not found. The saved marker was retained." },
  "account-changed": { state: "blocked", message: "The signed-in LinkedIn account changed during collection." },
  "parse-failure": { state: "blocked", message: "The page layout could not be read reliably." },
  unexpected: { state: "blocked", message: "Collection stopped because of an unexpected error." },
};

async function finish(
  adapter: CollectorAdapter,
  accountKey: string,
  stopReason: StopReason,
  message?: string,
): Promise<CollectorOutcome> {
  const outcome = OUTCOMES[stopReason];
  const finalMessage = message ?? outcome.message;
  await adapter.updateRun(accountKey, {
    state: outcome.state,
    stopReason,
    message: finalMessage,
  });
  return { stopReason, message: finalMessage };
}

function firstCanonicalCandidate(candidates: ConnectionCandidate[]): string | null {
  for (const candidate of candidates) {
    const url = canonicalizeProfileUrl(candidate.profileUrl);
    if (url) return url;
  }
  return null;
}

function containsCursor(candidates: ConnectionCandidate[], cursor: string): boolean {
  return candidates.some(
    (candidate) => canonicalizeProfileUrl(candidate.profileUrl) === cursor,
  );
}

export async function runCollector(
  adapter: CollectorAdapter,
  settings: CollectorSettings,
  context: CollectionContext,
  signal: AbortSignal,
): Promise<CollectorOutcome> {
  const { account, previousCursor } = context;
  const startedAt = adapter.now();
  let noGrowthCycles = 0;
  let failureRatioCycles = 0;
  let parseFailures = 0;
  let candidateCursor: string | null = null;

  await adapter.updateRun(account.accountKey, {
    state: "collecting",
    addedThisRun: 0,
    duplicates: 0,
    parseFailures: 0,
    message: previousCursor
      ? "Refreshing connections until the saved marker…"
      : "Collecting rendered connections…",
    startedAt: new Date(startedAt).toISOString(),
    stopReason: null,
  });

  try {
    while (true) {
      if (signal.aborted) {
        const reason = signal.reason === "hidden-tab" ? "hidden-tab" : "user";
        return await finish(adapter, account.accountKey, reason);
      }
      if (!adapter.isVisible()) return await finish(adapter, account.accountKey, "hidden-tab");
      if (!adapter.isSupported()) return await finish(adapter, account.accountKey, "unsupported-page");
      if (adapter.currentAccountKey() !== account.accountKey) {
        return await finish(adapter, account.accountKey, "account-changed");
      }

      const checkpoint = adapter.checkpoint();
      if (checkpoint) return await finish(adapter, account.accountKey, "checkpoint", checkpoint);
      if (adapter.now() - startedAt >= settings.maxDurationMs) {
        return await finish(adapter, account.accountKey, "duration-limit");
      }

      const parsed = await adapter.scan();
      candidateCursor ??= firstCanonicalCandidate(parsed.candidates);
      parseFailures += parsed.failures;
      const ingest = await adapter.ingest(account.accountKey, parsed.candidates);
      await adapter.updateRun(account.accountKey, { parseFailures });

      if (previousCursor && containsCursor(parsed.candidates, previousCursor)) {
        if (candidateCursor) {
          await adapter.promoteCursor(
            account.accountKey,
            candidateCursor,
            new Date(adapter.now()).toISOString(),
          );
        }
        return await finish(adapter, account.accountKey, "up-to-date");
      }

      if (ingest.totalUnique >= settings.maxRecords) {
        return await finish(adapter, account.accountKey, "record-limit");
      }

      const broadFailure =
        parsed.examined > 0 && parsed.failures / parsed.examined >= 0.8;
      failureRatioCycles = broadFailure ? failureRatioCycles + 1 : 0;
      if (failureRatioCycles >= settings.maxFailureRatioCycles) {
        return await finish(adapter, account.accountKey, "parse-failure");
      }

      const previousHeight = adapter.documentHeight();
      adapter.scrollByViewport();
      const grew = await adapter.waitForGrowth(previousHeight, settings.renderTimeoutMs);
      noGrowthCycles = !grew && ingest.added === 0 ? noGrowthCycles + 1 : 0;
      if (noGrowthCycles >= settings.maxNoGrowthCycles) {
        if (previousCursor) {
          return await finish(adapter, account.accountKey, "cursor-not-found");
        }
        if (candidateCursor) {
          await adapter.promoteCursor(
            account.accountKey,
            candidateCursor,
            new Date(adapter.now()).toISOString(),
          );
        }
        return await finish(adapter, account.accountKey, "no-growth");
      }
    }
  } catch (caught) {
    const message = caught instanceof Error ? "Collection failed: " + caught.message : undefined;
    return await finish(adapter, account.accountKey, "unexpected", message);
  }
}
