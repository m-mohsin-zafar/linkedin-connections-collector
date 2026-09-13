import { describe, expect, it } from "vitest";
import {
  createContentController,
  type ContentControllerAdapter,
} from "../src/content/index";
import type { ParseResult, RunState } from "../src/shared/types";

function createAdapter(
  overrides: Partial<ContentControllerAdapter> = {},
): ContentControllerAdapter {
  return {
    isVisible: () => true,
    isSupported: () => true,
    checkpoint: () => null,
    scan: async (): Promise<ParseResult> => ({
      candidates: [{ name: "Ada", profileUrl: "/in/ada/" }],
      failures: 1,
      examined: 2,
    }),
    ingest: async () => ({ added: 1, duplicates: 0, totalUnique: 1 }),
    updateRun: async () => undefined,
    now: () => 0,
    documentHeight: () => 1000,
    scrollByViewport: () => undefined,
    waitForGrowth: async () => false,
    ...overrides,
  };
}

describe("content controller", () => {
  it("scans the visible supported page once without scrolling", async () => {
    let scrolled = false;
    const patches: Partial<RunState>[] = [];
    const controller = createContentController(
      createAdapter({
        scrollByViewport: () => {
          scrolled = true;
        },
        updateRun: async (patch) => {
          patches.push(patch);
        },
      }),
    );

    const response = await controller.handle({ type: "SCAN_VISIBLE" });
    expect(response).toMatchObject({
      ok: true,
      data: { added: 1, duplicates: 0, totalUnique: 1 },
    });
    expect(scrolled).toBe(false);
    expect(patches.at(-1)).toMatchObject({ parseFailures: 1 });
  });

  it("rejects scans when a checkpoint is present", async () => {
    const controller = createContentController(
      createAdapter({ checkpoint: () => "Verification checkpoint detected" }),
    );

    expect(await controller.handle({ type: "SCAN_VISIBLE" })).toEqual({
      ok: false,
      error: {
        code: "checkpoint",
        message: "Verification checkpoint detected",
      },
    });
  });

  it("aborts an active run when stop is requested", async () => {
    let observedSignal: AbortSignal | undefined;
    const controller = createContentController(
      createAdapter(),
      async (_adapter, _settings, signal) => {
        observedSignal = signal;
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return { stopReason: "user", message: "Stopped" };
      },
    );

    await controller.handle({
      type: "START_COLLECTION",
      settings: {
        maxRecords: 100,
        maxDurationMs: 60_000,
        renderTimeoutMs: 100,
        maxNoGrowthCycles: 3,
        maxFailureRatioCycles: 2,
      },
    });
    expect(observedSignal?.aborted).toBe(false);

    await controller.handle({ type: "STOP_COLLECTION" });
    expect(observedSignal?.aborted).toBe(true);
  });
});
