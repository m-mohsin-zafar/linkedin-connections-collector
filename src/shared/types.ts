export interface ConnectionCandidate {
  name: string;
  headline?: string | null;
  profileUrl: string;
  connectedOn?: string | null;
}

export interface ConnectionRecord {
  name: string;
  headline: string | null;
  profileUrl: string;
  connectedOn: string | null;
  collectedAt: string;
}

export interface AccountIdentity {
  accountKey: string;
  displayName: string | null;
}

export interface AccountIdentityResult {
  identity: AccountIdentity | null;
  reason: string | null;
}

export interface MergeResult {
  records: ConnectionRecord[];
  added: number;
  duplicates: number;
}

export type RunStatus =
  | "idle"
  | "collecting"
  | "paused"
  | "completed"
  | "blocked";

export type StopReason =
  | "user"
  | "record-limit"
  | "duration-limit"
  | "hidden-tab"
  | "unsupported-page"
  | "checkpoint"
  | "no-growth"
  | "up-to-date"
  | "cursor-not-found"
  | "account-changed"
  | "parse-failure"
  | "unexpected";

export interface RunState {
  state: RunStatus;
  totalUnique: number;
  addedThisRun: number;
  duplicates: number;
  parseFailures: number;
  message: string | null;
  startedAt: string | null;
  stopReason: StopReason | null;
}

export interface CollectorSettings {
  maxRecords: number;
  maxDurationMs: number;
  renderTimeoutMs: number;
  maxNoGrowthCycles: number;
  maxFailureRatioCycles: number;
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

export interface ExtensionSnapshot {
  account?: AccountIdentity;
  records: ConnectionRecord[];
  refreshCursor?: string | null;
  lastCompletedAt?: string | null;
  run: RunState;
}

export interface ParseResult {
  candidates: ConnectionCandidate[];
  failures: number;
  examined: number;
}

export type ExtensionErrorCode =
  | "unsupported-page"
  | "account"
  | "checkpoint"
  | "storage"
  | "parse"
  | "limit"
  | "unexpected";

export type ExtensionMessage =
  | { type: "GET_SNAPSHOT" }
  | { type: "START_COLLECTION"; settings: CollectorSettings }
  | { type: "STOP_COLLECTION" }
  | { type: "SCAN_VISIBLE" }
  | { type: "CLEAR_DATA" }
  | { type: "EXPORT_CSV" }
  | { type: "EXPORT_JSON" }
  | { type: "RESOLVE_ACCOUNT" }
  | {
      type: "START_COLLECTION_CONTEXT";
      settings: CollectorSettings;
      context: CollectionContext;
    }
  | { type: "SCAN_VISIBLE_CONTEXT"; account: AccountIdentity }
  | {
      type: "INGEST_RECORDS";
      accountKey: string;
      candidates: ConnectionCandidate[];
    }
  | { type: "UPDATE_RUN"; accountKey: string; patch: Partial<RunState> }
  | {
      type: "PROMOTE_CURSOR";
      accountKey: string;
      cursor: string;
      completedAt: string;
    };

export type ExtensionResponse =
  | { ok: true; data?: unknown }
  | {
      ok: false;
      error: { code: ExtensionErrorCode; message: string };
    };
