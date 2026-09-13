import { mergeRecords } from "../shared/records";
import type {
  ConnectionRecord,
  ExtensionSnapshot,
  MergeResult,
  RunState,
} from "../shared/types";

const RECORDS_KEY = "connections.v1";
const RUN_KEY = "run.v1";

export interface StorageAreaLike {
  get(keys?: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export const EMPTY_RUN_STATE: RunState = {
  state: "idle",
  totalUnique: 0,
  addedThisRun: 0,
  duplicates: 0,
  parseFailures: 0,
  message: null,
  startedAt: null,
  stopReason: null,
};

function isConnectionRecord(value: unknown): value is ConnectionRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ConnectionRecord>;
  return (
    typeof record.name === "string" &&
    typeof record.profileUrl === "string" &&
    typeof record.collectedAt === "string" &&
    (record.headline === null || typeof record.headline === "string") &&
    (record.connectedOn === null || typeof record.connectedOn === "string")
  );
}

function readRunState(value: unknown): RunState {
  if (!value || typeof value !== "object") {
    return { ...EMPTY_RUN_STATE };
  }
  return { ...EMPTY_RUN_STATE, ...(value as Partial<RunState>) };
}

export class ConnectionRepository {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: StorageAreaLike) {}

  async getSnapshot(): Promise<ExtensionSnapshot> {
    const values = await this.storage.get([RECORDS_KEY, RUN_KEY]);
    const storedRecords = values[RECORDS_KEY];
    const records = Array.isArray(storedRecords)
      ? storedRecords.filter(isConnectionRecord)
      : [];
    const run = readRunState(values[RUN_KEY]);
    return {
      records,
      run: { ...run, totalUnique: records.length },
    };
  }

  ingest(records: ConnectionRecord[]): Promise<MergeResult> {
    return this.enqueue(async () => {
      const snapshot = await this.getSnapshot();
      const merged = mergeRecords(snapshot.records, records);
      const run: RunState = {
        ...snapshot.run,
        totalUnique: merged.records.length,
        addedThisRun: snapshot.run.addedThisRun + merged.added,
        duplicates: snapshot.run.duplicates + merged.duplicates,
      };
      await this.storage.set({
        [RECORDS_KEY]: merged.records,
        [RUN_KEY]: run,
      });
      return merged;
    });
  }

  updateRun(patch: Partial<RunState>): Promise<RunState> {
    return this.enqueue(async () => {
      const snapshot = await this.getSnapshot();
      const run: RunState = {
        ...snapshot.run,
        ...patch,
        totalUnique: snapshot.records.length,
      };
      await this.storage.set({ [RUN_KEY]: run });
      return run;
    });
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      await this.storage.remove([RECORDS_KEY, RUN_KEY]);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
