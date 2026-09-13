import { isSupportedConnectionsPage } from "../content/parser";
import { serializeCsv, serializeJson } from "../shared/export";
import { normalizeCandidate } from "../shared/records";
import type {
  ExtensionMessage,
  ExtensionResponse,
} from "../shared/types";
import {
  ConnectionRepository,
  type StorageAreaLike,
} from "./storage";

interface ActiveTab {
  id?: number;
  url?: string;
}

interface DownloadRequest {
  filename: string;
  mimeType: string;
  content: string;
}

export interface BackgroundDependencies {
  repository: ConnectionRepository;
  now: () => Date;
  getActiveTab: () => Promise<ActiveTab | null>;
  sendToTab: (
    tabId: number,
    message: ExtensionMessage,
  ) => Promise<ExtensionResponse>;
  download: (request: DownloadRequest) => Promise<void>;
}

function error(
  code: "unsupported-page" | "storage" | "unexpected",
  message: string,
): ExtensionResponse {
  return { ok: false, error: { code, message } };
}

function supportsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return isSupportedConnectionsPage(new URL(value));
  } catch {
    return false;
  }
}

export function createMessageHandler(dependencies: BackgroundDependencies) {
  return async (message: ExtensionMessage): Promise<ExtensionResponse> => {
    try {
      switch (message.type) {
        case "GET_SNAPSHOT":
          return {
            ok: true,
            data: await dependencies.repository.getSnapshot(),
          };

        case "INGEST_RECORDS": {
          const collectedAt = dependencies.now().toISOString();
          const records = message.candidates
            .map((candidate) => normalizeCandidate(candidate, collectedAt))
            .filter((record) => record !== null);
          return {
            ok: true,
            data: await dependencies.repository.ingest(records),
          };
        }

        case "UPDATE_RUN":
          return {
            ok: true,
            data: await dependencies.repository.updateRun(message.patch),
          };

        case "CLEAR_DATA":
          await dependencies.repository.clear();
          return { ok: true };

        case "EXPORT_CSV":
        case "EXPORT_JSON": {
          const snapshot = await dependencies.repository.getSnapshot();
          const exportedAt = dependencies.now().toISOString();
          const isCsv = message.type === "EXPORT_CSV";
          await dependencies.download({
            filename:
              "linkedin-connections-" +
              exportedAt.replaceAll(":", "-") +
              (isCsv ? ".csv" : ".json"),
            mimeType: isCsv
              ? "text/csv;charset=utf-8"
              : "application/json;charset=utf-8",
            content: isCsv
              ? serializeCsv(snapshot.records)
              : serializeJson(snapshot.records, exportedAt),
          });
          return { ok: true };
        }

        case "START_COLLECTION":
        case "STOP_COLLECTION":
        case "SCAN_VISIBLE": {
          const tab = await dependencies.getActiveTab();
          if (!tab?.id || !supportsUrl(tab.url)) {
            return error(
              "unsupported-page",
              "Open LinkedIn's Connections page before using this command.",
            );
          }
          return await dependencies.sendToTab(tab.id, message);
        }
      }
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Unexpected extension error";
      return error("unexpected", message);
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
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tab ?? null;
    },
    sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    download: async ({ filename, mimeType, content }) => {
      const url =
        "data:" + mimeType + "," + encodeURIComponent(content);
      await chrome.downloads.download({ url, filename, saveAs: true });
    },
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void handler(message as ExtensionMessage).then(sendResponse);
    return true;
  });
}
