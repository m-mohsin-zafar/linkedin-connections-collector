import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMessageHandler } from "../src/background/index";
import { ConnectionRepository } from "../src/background/storage";
import type { AccountIdentity, ExtensionMessage, ExtensionResponse } from "../src/shared/types";

class FakeStorageArea {
  private values: Record<string, unknown> = {};
  async get(keys?: string | string[]): Promise<Record<string, unknown>> {
    if (!keys) return structuredClone(this.values);
    const requested = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(requested.filter((key) => key in this.values).map((key) => [key, structuredClone(this.values[key])]));
  }
  async set(items: Record<string, unknown>): Promise<void> { Object.assign(this.values, structuredClone(items)); }
  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete this.values[key];
  }
}

const owner: AccountIdentity = {
  accountKey: "https://www.linkedin.com/in/owner",
  displayName: "Owner",
};

describe("background message handler", () => {
  const sendToTab = vi.fn(async (_tabId: number, message: ExtensionMessage): Promise<ExtensionResponse> =>
    message.type === "RESOLVE_ACCOUNT"
      ? { ok: true, data: owner }
      : { ok: true },
  );
  const download = vi.fn(async (_request: { filename: string; mimeType: string; content: string }) => undefined);
  let repository: ConnectionRepository;

  beforeEach(() => {
    repository = new ConnectionRepository(new FakeStorageArea());
    sendToTab.mockClear();
    download.mockClear();
  });

  function handler(url = "https://www.linkedin.com/mynetwork/invite-connect/connections/") {
    return createMessageHandler({
      repository,
      now: () => new Date("2026-09-13T00:00:00.000Z"),
      getActiveTab: async () => ({ id: 7, url }),
      sendToTab,
      download,
    });
  }

  it("resolves the active account before returning its snapshot", async () => {
    const response = await handler()({ type: "GET_SNAPSHOT" });
    expect(response).toMatchObject({ ok: true, data: { account: owner, records: [] } });
    expect(sendToTab).toHaveBeenCalledWith(7, { type: "RESOLVE_ACCOUNT" });
  });

  it("normalizes candidates into their explicitly addressed account", async () => {
    const response = await handler()({
      type: "INGEST_RECORDS",
      accountKey: owner.accountKey,
      candidates: [{ name: " Ada ", headline: "", profileUrl: "/in/ada/?trk=x" }],
    });
    expect(response.ok).toBe(true);
    expect((await repository.getSnapshot(owner)).records).toEqual([{
      name: "Ada",
      headline: null,
      profileUrl: "https://www.linkedin.com/in/ada",
      connectedOn: null,
      collectedAt: "2026-09-13T00:00:00.000Z",
    }]);
  });

  it("starts with a snapshot of the previous account cursor", async () => {
    await repository.promoteCursor(owner.accountKey, "https://www.linkedin.com/in/ada", "2026-09-12T00:00:00.000Z");
    const message = {
      type: "START_COLLECTION" as const,
      settings: { maxRecords: 100, maxDurationMs: 1000, renderTimeoutMs: 10, maxNoGrowthCycles: 3, maxFailureRatioCycles: 2 },
    };
    expect(await handler()(message)).toMatchObject({ ok: true });
    expect(sendToTab).toHaveBeenLastCalledWith(7, {
      type: "START_COLLECTION_CONTEXT",
      settings: message.settings,
      context: { account: owner, previousCursor: "https://www.linkedin.com/in/ada" },
    });
  });

  it("routes a visible scan with the resolved account", async () => {
    await handler()({ type: "SCAN_VISIBLE" });
    expect(sendToTab).toHaveBeenLastCalledWith(7, {
      type: "SCAN_VISIBLE_CONTEXT",
      account: owner,
    });
  });

  it("fails closed when the account cannot be resolved", async () => {
    sendToTab.mockResolvedValueOnce({ ok: false, error: { code: "account", message: "Identity missing" } });
    expect(await handler()({ type: "GET_SNAPSHOT" })).toEqual({
      ok: false,
      error: { code: "account", message: "Identity missing" },
    });
  });

  it("exports and clears only the active account", async () => {
    await handler()({
      type: "INGEST_RECORDS",
      accountKey: owner.accountKey,
      candidates: [{ name: "Ada", profileUrl: "/in/ada/" }],
    });
    expect((await handler()({ type: "EXPORT_CSV" })).ok).toBe(true);
    expect(download.mock.calls[0]?.[0].content).toContain("https://www.linkedin.com/in/ada");
    expect((await handler()({ type: "CLEAR_DATA" })).ok).toBe(true);
    expect((await repository.getSnapshot(owner)).records).toEqual([]);
  });

  it("rejects user commands outside the supported page", async () => {
    const response = await handler("https://www.linkedin.com/feed/")({ type: "GET_SNAPSHOT" });
    expect(response).toMatchObject({ ok: false, error: { code: "unsupported-page" } });
  });
});
