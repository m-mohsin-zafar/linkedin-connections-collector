import { isSupportedConnectionsPage } from "../content/parser";
import { serializeCsv, serializeJson } from "../shared/export";
import { canonicalizeProfileUrl, normalizeCandidate } from "../shared/records";
import type { AccountIdentity, ExtensionMessage, ExtensionResponse } from "../shared/types";
import { ConnectionRepository, type StorageAreaLike } from "./storage";

interface ActiveTab { id?: number; url?: string }
interface DownloadRequest { filename: string; mimeType: string; content: string }

export interface BackgroundDependencies {
  repository: ConnectionRepository;
  now: () => Date;
  getActiveTab: () => Promise<ActiveTab | null>;
  sendToTab: (tabId: number, message: ExtensionMessage) => Promise<ExtensionResponse>;
  download: (request: DownloadRequest) => Promise<void>;
}

function error(
  code: "unsupported-page" | "account" | "storage" | "unexpected",
  message: string,
): ExtensionResponse {
  return { ok: false, error: { code, message } };
}

function supportsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try { return isSupportedConnectionsPage(new URL(value)); } catch { return false; }
}

function asAccountIdentity(value: unknown): AccountIdentity | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AccountIdentity>;
  if (
    typeof candidate.accountKey !== "string" ||
    canonicalizeProfileUrl(candidate.accountKey) !== candidate.accountKey ||
    !(candidate.displayName === null || typeof candidate.displayName === "string")
  ) return null;
  return { accountKey: candidate.accountKey, displayName: candidate.displayName };
}

export function createMessageHandler(dependencies: BackgroundDependencies) {
  async function activeTab(): Promise<{ id: number } | ExtensionResponse> {
    const tab = await dependencies.getActiveTab();
    if (!tab?.id || !supportsUrl(tab.url)) {
      return error("unsupported-page", "Open LinkedIn's Connections page before using this command.");
    }
    return { id: tab.id };
  }

  async function activeAccount(): Promise<
    { tabId: number; account: AccountIdentity } | ExtensionResponse
  > {
    const tab = await activeTab();
    if ("ok" in tab) return tab;
    const response = await dependencies.sendToTab(tab.id, { type: "RESOLVE_ACCOUNT" });
    if (!response.ok) return response;
    const account = asAccountIdentity(response.data);
    return account
      ? { tabId: tab.id, account }
      : error("account", "The signed-in LinkedIn account could not be identified safely.");
  }

  return async (message: ExtensionMessage): Promise<ExtensionResponse> => {
    try {
      switch (message.type) {
        case "GET_SNAPSHOT": {
          const resolved = await activeAccount();
          if ("ok" in resolved) return resolved;
          return { ok: true, data: await dependencies.repository.getSnapshot(resolved.account) };
        }

        case "INGEST_RECORDS": {
          const collectedAt = dependencies.now().toISOString();
          const records = message.candidates
            .map((candidate) => normalizeCandidate(candidate, collectedAt))
            .filter((record) => record !== null);
          return { ok: true, data: await dependencies.repository.ingest(message.accountKey, records) };
        }

        case "UPDATE_RUN":
          return { ok: true, data: await dependencies.repository.updateRun(message.accountKey, message.patch) };

        case "PROMOTE_CURSOR":
          await dependencies.repository.promoteCursor(message.accountKey, message.cursor, message.completedAt);
          return { ok: true };

        case "CLEAR_DATA": {
          const resolved = await activeAccount();
          if ("ok" in resolved) return resolved;
          await dependencies.repository.clear(resolved.account.accountKey);
          return { ok: true };
        }

        case "EXPORT_CSV":
        case "EXPORT_JSON": {
          const resolved = await activeAccount();
          if ("ok" in resolved) return resolved;
          const snapshot = await dependencies.repository.getSnapshot(resolved.account);
          const exportedAt = dependencies.now().toISOString();
          const isCsv = message.type === "EXPORT_CSV";
          await dependencies.download({
            filename: "linkedin-connections-" + exportedAt.replaceAll(":", "-") + (isCsv ? ".csv" : ".json"),
            mimeType: isCsv ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
            content: isCsv ? serializeCsv(snapshot.records) : serializeJson(snapshot.records, exportedAt),
          });
          return { ok: true };
        }

        case "START_COLLECTION": {
          const resolved = await activeAccount();
          if ("ok" in resolved) return resolved;
          const snapshot = await dependencies.repository.getSnapshot(resolved.account);
          return await dependencies.sendToTab(resolved.tabId, {
            type: "START_COLLECTION_CONTEXT",
            settings: message.settings,
            context: { account: resolved.account, previousCursor: snapshot.refreshCursor ?? null },
          });
        }

        case "SCAN_VISIBLE": {
          const resolved = await activeAccount();
          if ("ok" in resolved) return resolved;
          return await dependencies.sendToTab(resolved.tabId, {
            type: "SCAN_VISIBLE_CONTEXT",
            account: resolved.account,
          });
        }

        case "STOP_COLLECTION": {
          const tab = await activeTab();
          if ("ok" in tab) return tab;
          return await dependencies.sendToTab(tab.id, message);
        }

        case "RESOLVE_ACCOUNT":
        case "START_COLLECTION_CONTEXT":
        case "SCAN_VISIBLE_CONTEXT":
          return error("unexpected", "Internal page command reached the background handler.");
      }
    } catch (caught) {
      return error(
        "unexpected",
        caught instanceof Error ? caught.message : "Unexpected extension error",
      );
    }
  };
}

function chromeStorageArea(): StorageAreaLike {
  return {
    get: (keys) => chrome.storage.local.get(keys),
    set: (items) => chrome.storage.local.set(items),
    remove: (keys) => chrome.storage.local.remove(keys),
  };
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  const repository = new ConnectionRepository(chromeStorageArea());
  const handler = createMessageHandler({
    repository,
    now: () => new Date(),
    getActiveTab: async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab ?? null;
    },
    sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    download: async ({ filename, mimeType, content }) => {
      const url = "data:" + mimeType + "," + encodeURIComponent(content);
      await chrome.downloads.download({ url, filename, saveAs: true });
    },
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void handler(message as ExtensionMessage).then(sendResponse);
    return true;
  });
}
