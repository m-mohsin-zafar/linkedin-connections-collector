import type {
  AccountIdentity,
  AccountIdentityResult,
  CollectionContext,
  ExtensionMessage,
  ExtensionResponse,
  MergeResult,
  RunState,
  StopReason,
} from "../shared/types";
import { detectAccountIdentity } from "./account";
import { runCollector, type CollectorAdapter, type CollectorOutcome } from "./collector";
import { detectCheckpoint, isSupportedConnectionsPage, parseConnectionCards } from "./parser";

export type ContentControllerAdapter = CollectorAdapter;

type CollectorRunner = (
  adapter: CollectorAdapter,
  settings: Extract<ExtensionMessage, { type: "START_COLLECTION_CONTEXT" }>["settings"],
  context: CollectionContext,
  signal: AbortSignal,
) => Promise<CollectorOutcome>;

type AccountResolver = () => AccountIdentityResult | Promise<AccountIdentityResult>;

let cachedAccountIdentity: AccountIdentity | null = null;

export function waitForElementGrowth(
  root: HTMLElement | null,
  previousHeight: number,
  timeoutMs: number,
): Promise<boolean> {
  if (!root) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
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
        [...mutation.addedNodes].some((node) => node.nodeType === Node.ELEMENT_NODE),
      );
      if (addedContent || root.scrollHeight > previousHeight) finish(true);
    });
    observer.observe(root, { childList: true, subtree: true });
    const timeout = window.setTimeout(
      () => finish(root.scrollHeight > previousHeight),
      timeoutMs,
    );
  });
}

export function createContentController(
  adapter: ContentControllerAdapter,
  runner: CollectorRunner = runCollector,
  resolveAccount: AccountResolver = () => detectAccountIdentity(document),
) {
  let controller: AbortController | null = null;
  const stop = (reason: Extract<StopReason, "user" | "hidden-tab"> = "user") => {
    controller?.abort(reason);
    controller = null;
  };

  return {
    stop,
    async handle(message: ExtensionMessage): Promise<ExtensionResponse> {
      if (message.type === "RESOLVE_ACCOUNT") {
        const result = await resolveAccount();
        if (result.identity) cachedAccountIdentity = result.identity;
        return result.identity
          ? { ok: true, data: result.identity }
          : {
              ok: false,
              error: {
                code: "account",
                message: result.reason ?? "The signed-in LinkedIn account could not be identified.",
              },
            };
      }

      if (message.type === "START_COLLECTION_CONTEXT") {
        stop("user");
        controller = new AbortController();
        void runner(adapter, message.settings, message.context, controller.signal);
        return { ok: true };
      }

      if (message.type === "STOP_COLLECTION") {
        stop("user");
        return { ok: true };
      }

      if (message.type === "SCAN_VISIBLE_CONTEXT") {
        if (!adapter.isVisible() || !adapter.isSupported()) {
          return {
            ok: false,
            error: {
              code: "unsupported-page",
              message: "Keep LinkedIn's Connections page visible while scanning.",
            },
          };
        }
        if (adapter.currentAccountKey() !== message.account.accountKey) {
          return {
            ok: false,
            error: {
              code: "account",
              message: "The signed-in LinkedIn account changed before the scan.",
            },
          };
        }
        const checkpoint = adapter.checkpoint();
        if (checkpoint) {
          return { ok: false, error: { code: "checkpoint", message: checkpoint } };
        }

        const parsed = await adapter.scan();
        const result = await adapter.ingest(message.account.accountKey, parsed.candidates);
        await adapter.updateRun(message.account.accountKey, {
          state: "completed",
          parseFailures: parsed.failures,
          message: "Visible connections scanned.",
          stopReason: null,
        });
        return { ok: true, data: result };
      }

      return {
        ok: false,
        error: { code: "unexpected", message: "This command is not handled by the page collector." },
      };
    },
  };
}

async function resolveBrowserAccount(): Promise<AccountIdentityResult> {
  if (cachedAccountIdentity) {
    return {
      identity: cachedAccountIdentity,
      reason: null,
    };
  }
  const immediate = detectAccountIdentity(document);
  if (immediate.identity || !document.querySelector("header, nav")) {
    return immediate;
  }

  const meButton = [...document.querySelectorAll<HTMLButtonElement>("header button, nav button")]
    .find((button) => /^.*\bme\b.*$/i.test(button.textContent?.replace(/\s+/g, " ").trim() ?? ""));
  if (!meButton) return immediate;

  meButton.click();
  await new Promise((resolve) => window.setTimeout(resolve, 250));
  const opened = detectAccountIdentity(document);
  if (meButton.getAttribute("aria-expanded") === "true") {
    meButton.click();
  }
  if (opened.identity) cachedAccountIdentity = opened.identity;
  return opened;
}

function createBrowserAdapter(): ContentControllerAdapter {
  const scrollContainer = (): HTMLElement | null =>
    document.querySelector<HTMLElement>("main, [role='main']");

  return {
    now: () => Date.now(),
    isVisible: () => document.visibilityState === "visible",
    isSupported: () => isSupportedConnectionsPage(window.location),
    checkpoint: () => detectCheckpoint(document),
    currentAccountKey: () => cachedAccountIdentity?.accountKey ?? detectAccountIdentity(document).identity?.accountKey ?? null,
    scan: async () => parseConnectionCards(document),
    ingest: async (accountKey, candidates) => {
      const response = (await chrome.runtime.sendMessage({
        type: "INGEST_RECORDS",
        accountKey,
        candidates,
      } satisfies ExtensionMessage)) as ExtensionResponse;
      if (!response.ok) throw new Error(response.error.message);
      const result = response.data as MergeResult;
      return { added: result.added, duplicates: result.duplicates, totalUnique: result.records.length };
    },
    documentHeight: () => scrollContainer()?.scrollHeight ?? document.documentElement.scrollHeight,
    scrollByViewport: () => {
      const container = scrollContainer();
      if (container) {
        container.scrollBy({ top: container.clientHeight * 0.8, behavior: "auto" });
        return;
      }
      window.scrollBy({ top: window.innerHeight * 0.8, behavior: "auto" });
    },
    waitForGrowth: (previousHeight, timeoutMs) =>
      waitForElementGrowth(scrollContainer(), previousHeight, timeoutMs),
    updateRun: async (accountKey: string, patch: Partial<RunState>) => {
      const response = (await chrome.runtime.sendMessage({
        type: "UPDATE_RUN", accountKey, patch,
      } satisfies ExtensionMessage)) as ExtensionResponse;
      if (!response.ok) throw new Error(response.error.message);
    },
    promoteCursor: async (accountKey, cursor, completedAt) => {
      const response = (await chrome.runtime.sendMessage({
        type: "PROMOTE_CURSOR", accountKey, cursor, completedAt,
      } satisfies ExtensionMessage)) as ExtensionResponse;
      if (!response.ok) throw new Error(response.error.message);
    },
  };
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  const controller = createContentController(createBrowserAdapter(), undefined, resolveBrowserAccount);
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    if (!["RESOLVE_ACCOUNT", "START_COLLECTION_CONTEXT", "STOP_COLLECTION", "SCAN_VISIBLE_CONTEXT"].includes(message.type)) {
      return false;
    }
    void controller.handle(message).then(sendResponse);
    return true;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") controller.stop("hidden-tab");
  });
}
