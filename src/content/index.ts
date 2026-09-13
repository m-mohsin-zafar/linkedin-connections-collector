import type {
  ExtensionMessage,
  ExtensionResponse,
  MergeResult,
  RunState,
  StopReason,
} from "../shared/types";
import {
  runCollector,
  type CollectorAdapter,
  type CollectorOutcome,
} from "./collector";
import {
  detectCheckpoint,
  isSupportedConnectionsPage,
  parseConnectionCards,
} from "./parser";

export type ContentControllerAdapter = CollectorAdapter;

type CollectorRunner = (
  adapter: CollectorAdapter,
  settings: Extract<
    ExtensionMessage,
    { type: "START_COLLECTION" }
  >["settings"],
  signal: AbortSignal,
) => Promise<CollectorOutcome>;

export function createContentController(
  adapter: ContentControllerAdapter,
  runner: CollectorRunner = runCollector,
) {
  let controller: AbortController | null = null;
  const stop = (reason: Extract<StopReason, "user" | "hidden-tab"> = "user") => {
    controller?.abort(reason);
    controller = null;
  };

  return {
    stop,
    async handle(message: ExtensionMessage): Promise<ExtensionResponse> {
      if (message.type === "START_COLLECTION") {
        stop("user");
        controller = new AbortController();
        void runner(adapter, message.settings, controller.signal);
        return { ok: true };
      }

      if (message.type === "STOP_COLLECTION") {
        stop("user");
        return { ok: true };
      }

      if (message.type === "SCAN_VISIBLE") {
        if (!adapter.isVisible()) {
          return {
            ok: false,
            error: {
              code: "unsupported-page",
              message: "Keep the Connections tab visible while scanning.",
            },
          };
        }
        if (!adapter.isSupported()) {
          return {
            ok: false,
            error: {
              code: "unsupported-page",
              message: "Open LinkedIn's Connections page before scanning.",
            },
          };
        }
        const checkpoint = adapter.checkpoint();
        if (checkpoint) {
          return {
            ok: false,
            error: { code: "checkpoint", message: checkpoint },
          };
        }

        const parsed = await adapter.scan();
        const result = await adapter.ingest(parsed.candidates);
        await adapter.updateRun({
          state: "completed",
          parseFailures: parsed.failures,
          message: "Visible connections scanned.",
          stopReason: null,
        });
        return { ok: true, data: result };
      }

      return {
        ok: false,
        error: {
          code: "unexpected",
          message: "This command is not handled by the page collector.",
        },
      };
    },
  };
}

function createBrowserAdapter(): ContentControllerAdapter {
  return {
    now: () => Date.now(),
    isVisible: () => document.visibilityState === "visible",
    isSupported: () => isSupportedConnectionsPage(window.location),
    checkpoint: () => detectCheckpoint(document),
    scan: async () => parseConnectionCards(document),
    ingest: async (candidates) => {
      const response = (await chrome.runtime.sendMessage({
        type: "INGEST_RECORDS",
        candidates,
      } satisfies ExtensionMessage)) as ExtensionResponse;
      if (!response.ok) throw new Error(response.error.message);
      const result = response.data as MergeResult;
      return {
        added: result.added,
        duplicates: result.duplicates,
        totalUnique: result.records.length,
      };
    },
    documentHeight: () => document.documentElement.scrollHeight,
    scrollByViewport: () => {
      window.scrollBy({ top: window.innerHeight * 0.8, behavior: "auto" });
    },
    waitForGrowth: (previousHeight, timeoutMs) =>
      new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (grew: boolean) => {
          if (settled) return;
          settled = true;
          observer.disconnect();
          window.clearTimeout(timeout);
          resolve(grew);
        };
        const observer = new MutationObserver((mutations) => {
          const addedContent = mutations.some((mutation) =>
            [...mutation.addedNodes].some(
              (node) => node.nodeType === Node.ELEMENT_NODE,
            ),
          );
          if (
            addedContent ||
            document.documentElement.scrollHeight > previousHeight
          ) {
            finish(true);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        const timeout = window.setTimeout(
          () =>
            finish(
              document.documentElement.scrollHeight > previousHeight,
            ),
          timeoutMs,
        );
      }),
    updateRun: async (patch: Partial<RunState>) => {
      const response = (await chrome.runtime.sendMessage({
        type: "UPDATE_RUN",
        patch,
      } satisfies ExtensionMessage)) as ExtensionResponse;
      if (!response.ok) throw new Error(response.error.message);
    },
  };
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  const controller = createContentController(createBrowserAdapter());
  chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
      if (
        message.type !== "START_COLLECTION" &&
        message.type !== "STOP_COLLECTION" &&
        message.type !== "SCAN_VISIBLE"
      ) {
        return false;
      }
      void controller.handle(message).then(sendResponse);
      return true;
    },
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      controller.stop("hidden-tab");
    }
  });
}
