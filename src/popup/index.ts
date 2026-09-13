import type {
  CollectorSettings,
  ExtensionMessage,
  ExtensionResponse,
  ExtensionSnapshot,
  RunStatus,
} from "../shared/types";

const STATUS_LABELS: Record<RunStatus, string> = {
  idle: "Idle",
  collecting: "Collecting",
  paused: "Paused",
  completed: "Completed",
  blocked: "Blocked",
};

function element<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error("Missing popup element: " + selector);
  return found;
}

export function renderSnapshot(
  root: ParentNode,
  snapshot: ExtensionSnapshot,
): void {
  const { run } = snapshot;
  const hasCursor = Boolean(snapshot.refreshCursor);
  element<HTMLElement>(root, "[data-account]").textContent =
    snapshot.account?.displayName ?? snapshot.account?.accountKey ?? "Unknown account";
  element<HTMLElement>(root, "[data-mode]").textContent = hasCursor
    ? "Refresh mode"
    : "Initial collection";
  element<HTMLElement>(root, "[data-last-refresh]").textContent =
    snapshot.lastCompletedAt
      ? new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(snapshot.lastCompletedAt))
      : "Never";
  element<HTMLElement>(root, "[data-status]").textContent =
    STATUS_LABELS[run.state];
  element<HTMLElement>(root, "[data-status]").dataset.state = run.state;
  element<HTMLElement>(root, "[data-message]").textContent =
    run.message ?? "Ready to collect visible connection details.";
  element<HTMLElement>(root, "[data-total]").textContent = String(
    run.totalUnique,
  );
  element<HTMLElement>(root, "[data-added]").textContent = String(
    run.addedThisRun,
  );
  element<HTMLElement>(root, "[data-duplicates]").textContent = String(
    run.duplicates,
  );
  element<HTMLElement>(root, "[data-failures]").textContent = String(
    run.parseFailures,
  );

  const collecting = run.state === "collecting";
  const startButton = element<HTMLButtonElement>(root, "[data-start]");
  startButton.textContent = hasCursor ? "Refresh connections" : "Start collecting";
  startButton.hidden = collecting;
  element<HTMLButtonElement>(root, "[data-stop]").hidden = !collecting;
  element<HTMLButtonElement>(root, "[data-scan]").disabled = collecting;
  element<HTMLInputElement>(root, "[data-max-records]").disabled =
    collecting;
  element<HTMLInputElement>(root, "[data-max-minutes]").disabled =
    collecting;

  const hasRecords = run.totalUnique > 0;
  element<HTMLButtonElement>(root, "[data-export-csv]").disabled =
    !hasRecords;
  element<HTMLButtonElement>(root, "[data-export-json]").disabled =
    !hasRecords;
  element<HTMLButtonElement>(root, "[data-clear]").disabled =
    !hasRecords || collecting;
}

export function readCollectorSettings(
  root: ParentNode,
): CollectorSettings {
  const maxRecords = Number(
    element<HTMLInputElement>(root, "[data-max-records]").value,
  );
  const maxMinutes = Number(
    element<HTMLInputElement>(root, "[data-max-minutes]").value,
  );

  if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 20_000) {
    throw new Error("Max records must be between 1 and 20,000.");
  }
  if (!Number.isFinite(maxMinutes) || maxMinutes < 1 || maxMinutes > 240) {
    throw new Error("Max minutes must be between 1 and 240.");
  }

  return {
    maxRecords,
    maxDurationMs: maxMinutes * 60_000,
    renderTimeoutMs: 2_500,
    maxNoGrowthCycles: 3,
    maxFailureRatioCycles: 2,
  };
}

async function send(message: ExtensionMessage): Promise<unknown> {
  const response = (await chrome.runtime.sendMessage(
    message,
  )) as ExtensionResponse;
  if (!response.ok) throw new Error(response.error.message);
  return response.data;
}

async function initializePopup(root: Document): Promise<void> {
  let poll: number | null = null;

  const showError = (caught: unknown) => {
    element<HTMLElement>(root, "[data-message]").textContent =
      caught instanceof Error ? caught.message : "Unexpected extension error.";
    element<HTMLElement>(root, "[data-status]").textContent = "Blocked";
    element<HTMLElement>(root, "[data-status]").dataset.state = "blocked";
  };

  const refresh = async () => {
    try {
      const snapshot = (await send({
        type: "GET_SNAPSHOT",
      })) as ExtensionSnapshot;
      renderSnapshot(root, snapshot);
      if (snapshot.run.state === "collecting" && poll === null) {
        poll = window.setInterval(() => void refresh(), 1_000);
      } else if (snapshot.run.state !== "collecting" && poll !== null) {
        window.clearInterval(poll);
        poll = null;
      }
    } catch (caught) {
      showError(caught);
    }
  };

  const command = async (message: ExtensionMessage) => {
    try {
      await send(message);
      await refresh();
    } catch (caught) {
      showError(caught);
    }
  };

  element<HTMLButtonElement>(root, "[data-start]").addEventListener(
    "click",
    () => {
      try {
        void command({
          type: "START_COLLECTION",
          settings: readCollectorSettings(root),
        });
      } catch (caught) {
        showError(caught);
      }
    },
  );
  element<HTMLButtonElement>(root, "[data-stop]").addEventListener(
    "click",
    () => void command({ type: "STOP_COLLECTION" }),
  );
  element<HTMLButtonElement>(root, "[data-scan]").addEventListener(
    "click",
    () => void command({ type: "SCAN_VISIBLE" }),
  );
  element<HTMLButtonElement>(root, "[data-export-csv]").addEventListener(
    "click",
    () => void command({ type: "EXPORT_CSV" }),
  );
  element<HTMLButtonElement>(root, "[data-export-json]").addEventListener(
    "click",
    () => void command({ type: "EXPORT_JSON" }),
  );
  element<HTMLButtonElement>(root, "[data-clear]").addEventListener(
    "click",
    () => {
      if (window.confirm("Clear collected connections for the current LinkedIn account?")) {
        void command({ type: "CLEAR_DATA" });
      }
    },
  );

  await refresh();
}

export function shouldInitializePopup(protocol: string): boolean {
  return protocol === "chrome-extension:";
}

if (
  typeof chrome !== "undefined" &&
  shouldInitializePopup(window.location.protocol)
) {
  document.addEventListener(
    "DOMContentLoaded",
    () => void initializePopup(document),
  );
}
