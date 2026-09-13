import { describe, expect, it } from "vitest";
import { ConnectionRepository } from "../src/background/storage";
import type { ConnectionRecord } from "../src/shared/types";

class FakeStorageArea {
  private values: Record<string, unknown> = {};

  async get(keys?: string | string[]): Promise<Record<string, unknown>> {
    if (!keys) return { ...this.values };
    const requested = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(
      requested
        .filter((key) => key in this.values)
        .map((key) => [key, this.values[key]]),
    );
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      delete this.values[key];
    }
  }
}

const ada: ConnectionRecord = {
  name: "Ada",
  headline: null,
  profileUrl: "https://www.linkedin.com/in/ada",
  connectedOn: null,
  collectedAt: "2026-09-13T00:00:00.000Z",
};

describe("ConnectionRepository", () => {
  it("returns an empty idle snapshot when storage has no data", async () => {
    const repository = new ConnectionRepository(new FakeStorageArea());
    expect(await repository.getSnapshot()).toEqual({
      records: [],
      run: {
        state: "idle",
        totalUnique: 0,
        addedThisRun: 0,
        duplicates: 0,
        parseFailures: 0,
        message: null,
        startedAt: null,
        stopReason: null,
      },
    });
  });

  it("persists merged records and updates run counters", async () => {
    const repository = new ConnectionRepository(new FakeStorageArea());
    const first = await repository.ingest([ada]);
    const duplicate = await repository.ingest([
      { ...ada, headline: "Engineer" },
    ]);
    const snapshot = await repository.getSnapshot();

    expect(first).toMatchObject({ added: 1, duplicates: 0 });
    expect(duplicate).toMatchObject({ added: 0, duplicates: 1 });
    expect(snapshot.records).toEqual([{ ...ada, headline: "Engineer" }]);
    expect(snapshot.run).toMatchObject({
      totalUnique: 1,
      addedThisRun: 1,
      duplicates: 1,
    });
  });

  it("serializes overlapping ingestion without losing records", async () => {
    const repository = new ConnectionRepository(new FakeStorageArea());
    const grace: ConnectionRecord = {
      ...ada,
      name: "Grace",
      profileUrl: "https://www.linkedin.com/in/grace",
    };

    await Promise.all([repository.ingest([ada]), repository.ingest([grace])]);
    expect((await repository.getSnapshot()).records).toHaveLength(2);
  });

  it("updates allowed run metadata and clears all state", async () => {
    const repository = new ConnectionRepository(new FakeStorageArea());
    await repository.ingest([ada]);
    await repository.updateRun({
      state: "blocked",
      message: "Checkpoint detected",
      stopReason: "checkpoint",
    });
    expect((await repository.getSnapshot()).run).toMatchObject({
      state: "blocked",
      message: "Checkpoint detected",
      stopReason: "checkpoint",
    });

    await repository.clear();
    expect((await repository.getSnapshot()).records).toHaveLength(0);
    expect((await repository.getSnapshot()).run.state).toBe("idle");
  });
});
