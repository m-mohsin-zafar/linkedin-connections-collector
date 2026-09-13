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

export interface ExtensionSnapshot {
  records: ConnectionRecord[];
  run: RunState;
}

export interface ParseResult {
  candidates: ConnectionCandidate[];
  failures: number;
  examined: number;
}

export type ExtensionErrorCode =
  | "unsupported-page"
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
  | { type: "INGEST_RECORDS"; candidates: ConnectionCandidate[] }
  | { type: "UPDATE_RUN"; patch: Partial<RunState> };

export type ExtensionResponse =
  | { ok: true; data?: unknown }
  | {
      ok: false;
      error: { code: ExtensionErrorCode; message: string };
    };
