import { canonicalizeProfileUrl, mergeRecords } from "../shared/records";
import type {
  AccountDataset,
  AccountIdentity,
  ConnectionRecord,
  ExtensionSnapshot,
  MergeResult,
  RunState,
} from "../shared/types";

export const ACCOUNTS_KEY = "accounts.v2";

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

function isCanonicalProfileUrl(value: string): boolean {
  return canonicalizeProfileUrl(value) === value;
}

function requireCanonical(value: string, label: "account" | "cursor"): void {
  if (!isCanonicalProfileUrl(value)) {
    throw new Error("Expected a canonical " + label + " profile URL");
  }
}

function isConnectionRecord(value: unknown): value is ConnectionRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ConnectionRecord>;
  return (
    typeof record.name === "string" &&
    typeof record.profileUrl === "string" &&
    isCanonicalProfileUrl(record.profileUrl) &&
    typeof record.collectedAt === "string" &&
    (record.headline === null || typeof record.headline === "string") &&
    (record.connectedOn === null || typeof record.connectedOn === "string")
  );
}

function readRunState(value: unknown): RunState {
  if (!value || typeof value !== "object") return { ...EMPTY_RUN_STATE };
  return { ...EMPTY_RUN_STATE, ...(value as Partial<RunState>) };
}

function emptyDataset(account: AccountIdentity): AccountDataset {
  return {
    ...account,
    records: [],
    refreshCursor: null,
    lastCompletedAt: null,
    run: { ...EMPTY_RUN_STATE },
  };
}

function readDataset(value: unknown, fallback: AccountIdentity): AccountDataset {
  if (!value || typeof value !== "object") return emptyDataset(fallback);
  const stored = value as Partial<AccountDataset>;
  const records = Array.isArray(stored.records)
    ? stored.records.filter(isConnectionRecord)
    : [];
  const refreshCursor =
    typeof stored.refreshCursor === "string" &&
    isCanonicalProfileUrl(stored.refreshCursor)
      ? stored.refreshCursor
      : null;
  return {
    accountKey: fallback.accountKey,
    displayName:
      fallback.displayName ??
      (typeof stored.displayName === "string" ? stored.displayName : null),
    records,
    refreshCursor,
    lastCompletedAt:
      typeof stored.lastCompletedAt === "string" ? stored.lastCompletedAt : null,
    run: { ...readRunState(stored.run), totalUnique: records.length },
  };
}

function readAccounts(value: unknown): Record<string, AccountDataset> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const accounts: Record<string, AccountDataset> = {};
  for (const [accountKey, dataset] of Object.entries(value)) {
    if (!isCanonicalProfileUrl(accountKey)) continue;
    accounts[accountKey] = readDataset(dataset, {
      accountKey,
      displayName: null,
    });
  }
  return accounts;
}

export class ConnectionRepository {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: StorageAreaLike) {}

  async getSnapshot(account: AccountIdentity): Promise<ExtensionSnapshot> {
    requireCanonical(account.accountKey, "account");
    const values = await this.storage.get(ACCOUNTS_KEY);
    const accounts = readAccounts(values[ACCOUNTS_KEY]);
    const dataset = readDataset(accounts[account.accountKey], account);
    return {
      account: { accountKey: dataset.accountKey, displayName: dataset.displayName },
      records: dataset.records,
      refreshCursor: dataset.refreshCursor,
      lastCompletedAt: dataset.lastCompletedAt,
      run: dataset.run,
    };
  }

  async ingest(accountKey: string, records: ConnectionRecord[]): Promise<MergeResult> {
    requireCanonical(accountKey, "account");
    return this.mutate(accountKey, (dataset) => {
      const merged = mergeRecords(dataset.records, records);
      dataset.records = merged.records;
      dataset.run = {
        ...dataset.run,
        totalUnique: merged.records.length,
        addedThisRun: dataset.run.addedThisRun + merged.added,
        duplicates: dataset.run.duplicates + merged.duplicates,
      };
      return merged;
    });
  }

  async updateRun(accountKey: string, patch: Partial<RunState>): Promise<RunState> {
    requireCanonical(accountKey, "account");
    return this.mutate(accountKey, (dataset) => {
      dataset.run = {
        ...dataset.run,
        ...patch,
        totalUnique: dataset.records.length,
      };
      return dataset.run;
    });
  }

  async promoteCursor(
    accountKey: string,
    cursor: string,
    completedAt: string,
  ): Promise<void> {
    requireCanonical(accountKey, "account");
    requireCanonical(cursor, "cursor");
    return this.mutate(accountKey, (dataset) => {
      dataset.refreshCursor = cursor;
      dataset.lastCompletedAt = completedAt;
    });
  }

  async clear(accountKey: string): Promise<void> {
    requireCanonical(accountKey, "account");
    return this.enqueue(async () => {
      const values = await this.storage.get(ACCOUNTS_KEY);
      const accounts = readAccounts(values[ACCOUNTS_KEY]);
      delete accounts[accountKey];
      await this.storage.set({ [ACCOUNTS_KEY]: accounts });
    });
  }

  private mutate<T>(
    accountKey: string,
    change: (dataset: AccountDataset) => T,
  ): Promise<T> {
    return this.enqueue(async () => {
      const values = await this.storage.get(ACCOUNTS_KEY);
      const accounts = readAccounts(values[ACCOUNTS_KEY]);
      const dataset = readDataset(accounts[accountKey], {
        accountKey,
        displayName: null,
      });
      const result = change(dataset);
      accounts[accountKey] = dataset;
      await this.storage.set({ [ACCOUNTS_KEY]: accounts });
      return result;
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
