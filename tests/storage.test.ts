import { describe, expect, it } from "vitest";
import { ConnectionRepository } from "../src/background/storage";
import type { AccountIdentity, ConnectionRecord } from "../src/shared/types";

class FakeStorageArea {
  private values: Record<string, unknown>;

  constructor(initial: Record<string, unknown> = {}) {
    this.values = structuredClone(initial);
  }

  async get(keys?: string | string[]): Promise<Record<string, unknown>> {
    if (!keys) return structuredClone(this.values);
    const requested = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(
      requested
        .filter((key) => key in this.values)
        .map((key) => [key, structuredClone(this.values[key])]),
    );
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete this.values[key];
  }
}

const ownerA: AccountIdentity = {
  accountKey: "https://www.linkedin.com/in/owner-a",
  displayName: "Owner A",
};
const ownerB: AccountIdentity = {
  accountKey: "https://www.linkedin.com/in/owner-b",
  displayName: "Owner B",
};
const ada: ConnectionRecord = {
  name: "Ada",
  headline: null,
  profileUrl: "https://www.linkedin.com/in/ada",
  connectedOn: null,
  collectedAt: "2026-09-13T00:00:00.000Z",
};
const grace: ConnectionRecord = {
  ...ada,
  name: "Grace",
  profileUrl: "https://www.linkedin.com/in/grace",
};

describe("ConnectionRepository", () => {
  it("returns an account-scoped empty snapshot without writing storage", async () => {
    const area = new FakeStorageArea();
    const repository = new ConnectionRepository(area);
    expect(await repository.getSnapshot(ownerA)).toMatchObject({
      account: ownerA,
      records: [],
      refreshCursor: null,
      lastCompletedAt: null,
      run: { state: "idle", totalUnique: 0 },
    });
    expect(await area.get()).toEqual({});
  });

  it("isolates records and counters for two accounts", async () => {
    const repository = new ConnectionRepository(new FakeStorageArea());
    await repository.ingest(ownerA.accountKey, [ada]);
    await repository.ingest(ownerB.accountKey, [grace]);
    expect((await repository.getSnapshot(ownerA)).records).toEqual([ada]);
    expect((await repository.getSnapshot(ownerB)).records).toEqual([grace]);
  });

  it("serializes overlapping ingestion without losing records", async () => {
    const repository = new ConnectionRepository(new FakeStorageArea());
    await Promise.all([
      repository.ingest(ownerA.accountKey, [ada]),
      repository.ingest(ownerA.accountKey, [grace]),
    ]);
    expect((await repository.getSnapshot(ownerA)).records).toHaveLength(2);
  });

  it("promotes and preserves a cursor per account", async () => {
    const repository = new ConnectionRepository(new FakeStorageArea());
    await repository.promoteCursor(
      ownerA.accountKey,
      ada.profileUrl,
      "2026-09-13T12:00:00.000Z",
    );
    expect(await repository.getSnapshot(ownerA)).toMatchObject({
      refreshCursor: ada.profileUrl,
      lastCompletedAt: "2026-09-13T12:00:00.000Z",
    });
    expect((await repository.getSnapshot(ownerB)).refreshCursor).toBeNull();
  });

  it("updates run metadata only for the addressed account", async () => {
    const repository = new ConnectionRepository(new FakeStorageArea());
    await repository.ingest(ownerA.accountKey, [ada]);
    await repository.updateRun(ownerA.accountKey, {
      state: "blocked",
      message: "Checkpoint detected",
      stopReason: "checkpoint",
    });
    expect((await repository.getSnapshot(ownerA)).run).toMatchObject({
      state: "blocked",
      totalUnique: 1,
      stopReason: "checkpoint",
    });
    expect((await repository.getSnapshot(ownerB)).run.state).toBe("idle");
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

  it("rejects noncanonical account and cursor keys", async () => {
    const repository = new ConnectionRepository(new FakeStorageArea());
    await expect(
      repository.ingest("https://www.linkedin.com/in/owner-a/", [ada]),
    ).rejects.toThrow(/canonical account/i);
    await expect(
      repository.promoteCursor(ownerA.accountKey, ada.profileUrl + "/", "now"),
    ).rejects.toThrow(/canonical cursor/i);
  });
});
