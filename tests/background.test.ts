import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMessageHandler } from "../src/background/index";
import { ConnectionRepository } from "../src/background/storage";

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

describe("background message handler", () => {
  const sendToTab = vi.fn(async () => ({ ok: true as const }));
  const download = vi.fn(
    async (_request: {
      filename: string;
      mimeType: string;
      content: string;
    }) => undefined,
  );
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

  it("normalizes candidates before ingestion", async () => {
    const response = await handler()({
      type: "INGEST_RECORDS",
      candidates: [
        {
          name: " Ada ",
          headline: "",
          profileUrl: "/in/ada/?trk=x",
        },
      ],
    });

    expect(response.ok).toBe(true);
    expect((await repository.getSnapshot()).records).toEqual([
      {
        name: "Ada",
        headline: null,
        profileUrl: "https://www.linkedin.com/in/ada",
        connectedOn: null,
        collectedAt: "2026-09-13T00:00:00.000Z",
      },
    ]);
  });

  it("forwards collection commands only to a supported active tab", async () => {
    const message = {
      type: "SCAN_VISIBLE" as const,
    };
    expect(await handler()(message)).toMatchObject({ ok: true });
    expect(sendToTab).toHaveBeenCalledWith(7, message);

    const rejected = await handler("https://www.linkedin.com/feed/")(message);
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: "unsupported-page" },
    });
  });

  it("exports CSV through the injected downloader", async () => {
    await handler()({
      type: "INGEST_RECORDS",
      candidates: [{ name: "Ada", profileUrl: "/in/ada/" }],
    });
    const response = await handler()({ type: "EXPORT_CSV" });

    expect(response.ok).toBe(true);
    expect(download).toHaveBeenCalledOnce();
    expect(download.mock.calls[0]?.[0]).toMatchObject({
      mimeType: "text/csv;charset=utf-8",
    });
    expect(download.mock.calls[0]?.[0].content).toContain(
      "https://www.linkedin.com/in/ada",
    );
  });
});
