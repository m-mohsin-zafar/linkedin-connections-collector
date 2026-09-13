import { describe, expect, it } from "vitest";
import { createContentController, type ContentControllerAdapter } from "../src/content/index";
import type { AccountIdentity, CollectionContext, ParseResult, RunState } from "../src/shared/types";

const owner: AccountIdentity = {
  accountKey: "https://www.linkedin.com/in/owner",
  displayName: "Owner",
};

function createAdapter(overrides: Partial<ContentControllerAdapter> = {}): ContentControllerAdapter {
  return {
    isVisible: () => true,
    isSupported: () => true,
    checkpoint: () => null,
    currentAccountKey: () => owner.accountKey,
    scan: async (): Promise<ParseResult> => ({
      candidates: [{ name: "Ada", profileUrl: "/in/ada/" }],
      failures: 1,
      examined: 2,
    }),
    ingest: async () => ({ added: 1, duplicates: 0, totalUnique: 1 }),
    updateRun: async () => undefined,
    promoteCursor: async () => undefined,
    now: () => 0,
    documentHeight: () => 1000,
    scrollByViewport: () => undefined,
    waitForGrowth: async () => false,
    ...overrides,
  };
}

describe("content controller", () => {
  it("returns the signed-in account identity", async () => {
    const controller = createContentController(createAdapter(), undefined, () => ({
      identity: owner,
      reason: null,
    }));
    expect(await controller.handle({ type: "RESOLVE_ACCOUNT" })).toEqual({
      ok: true,
      data: owner,
    });
  });

  it("fails closed when account identity is unavailable", async () => {
    const controller = createContentController(createAdapter(), undefined, () => ({
      identity: null,
      reason: "Identity missing",
    }));
    expect(await controller.handle({ type: "RESOLVE_ACCOUNT" })).toEqual({
      ok: false,
      error: { code: "account", message: "Identity missing" },
    });
  });

  it("scans once into the explicitly addressed account", async () => {
    const calls: Array<{ accountKey: string; patch?: Partial<RunState> }> = [];
    const controller = createContentController(createAdapter({
      ingest: async (accountKey) => {
        calls.push({ accountKey });
        return { added: 1, duplicates: 0, totalUnique: 1 };
      },
      updateRun: async (accountKey, patch) => { calls.push({ accountKey, patch }); },
    }));
    const response = await controller.handle({ type: "SCAN_VISIBLE_CONTEXT", account: owner });
    expect(response).toMatchObject({ ok: true, data: { added: 1 } });
    expect(calls.every((call) => call.accountKey === owner.accountKey)).toBe(true);
  });

  it("rejects a scan if the current account differs from its context", async () => {
    const controller = createContentController(createAdapter({
      currentAccountKey: () => "https://www.linkedin.com/in/other",
    }));
    expect(await controller.handle({ type: "SCAN_VISIBLE_CONTEXT", account: owner })).toMatchObject({
      ok: false,
      error: { code: "account" },
    });
  });

  it("passes collection context to the runner and aborts on stop", async () => {
    let observedSignal: AbortSignal | undefined;
    let observedContext: CollectionContext | undefined;
    const context = { account: owner, previousCursor: "https://www.linkedin.com/in/ada" };
    const controller = createContentController(
      createAdapter(),
      async (_adapter, _settings, receivedContext, signal) => {
        observedContext = receivedContext;
        observedSignal = signal;
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        return { stopReason: "user", message: "Stopped" };
      },
    );
    await controller.handle({
      type: "START_COLLECTION_CONTEXT",
      context,
      settings: {
        maxRecords: 100,
        maxDurationMs: 60_000,
        renderTimeoutMs: 100,
        maxNoGrowthCycles: 3,
        maxFailureRatioCycles: 2,
      },
    });
    expect(observedContext).toEqual(context);
    await controller.handle({ type: "STOP_COLLECTION" });
    expect(observedSignal?.aborted).toBe(true);
  });
});
