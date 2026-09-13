import { beforeEach, describe, expect, it } from "vitest";
import {
  readCollectorSettings,
  renderRecoverableNotice,
  renderSnapshot,
  shouldInitializePopup,
} from "../src/popup/index";
import type { ExtensionSnapshot } from "../src/shared/types";

const snapshot: ExtensionSnapshot = {
  account: {
    accountKey: "https://www.linkedin.com/in/owner",
    displayName: "Owner",
  },
  records: [],
  refreshCursor: "https://www.linkedin.com/in/ada",
  lastCompletedAt: "2026-09-12T12:00:00.000Z",
  run: {
    state: "collecting",
    totalUnique: 12,
    addedThisRun: 4,
    duplicates: 2,
    parseFailures: 1,
    message: "Collecting rendered connections…",
    startedAt: "2026-09-13T00:00:00.000Z",
    stopReason: null,
  },
};

beforeEach(() => {
  document.body.innerHTML = [
    '<span data-status></span><span data-message></span>',
    '<strong data-account></strong><span data-mode></span><span data-last-refresh></span>',
    '<strong data-total></strong><strong data-added></strong>',
    '<strong data-duplicates></strong><strong data-failures></strong>',
    '<input data-max-records value="1000">',
    '<input data-max-minutes value="30">',
    '<button data-start></button><button data-stop hidden></button>',
    '<button data-scan></button><button data-export-csv></button>',
    '<button data-export-json></button><button data-clear></button>',
  ].join("");
});

describe("renderSnapshot", () => {
  it("renders collecting status, counters, and the stop action", () => {
    renderSnapshot(document.body, snapshot);

    expect(document.querySelector("[data-status]")?.textContent).toBe(
      "Collecting",
    );
    expect(document.querySelector("[data-total]")?.textContent).toBe("12");
    expect(document.querySelector("[data-added]")?.textContent).toBe("4");
    expect(document.querySelector("[data-account]")?.textContent).toBe("Owner");
    expect(document.querySelector("[data-mode]")?.textContent).toBe("Refresh mode");
    expect(document.querySelector("[data-last-refresh]")?.textContent).not.toBe("Never");
    expect(document.querySelector("[data-start]")?.textContent).toBe("Refresh connections");
    expect(
      (document.querySelector("[data-start]") as HTMLButtonElement).hidden,
    ).toBe(true);
    expect(
      (document.querySelector("[data-stop]") as HTMLButtonElement).hidden,
    ).toBe(false);
  });

  it("shows initial mode when the account has no saved cursor", () => {
    renderSnapshot(document.body, {
      ...snapshot,
      refreshCursor: null,
      lastCompletedAt: null,
      run: { ...snapshot.run, state: "idle" },
    });
    expect(document.querySelector("[data-mode]")?.textContent).toBe("Initial collection");
    expect(document.querySelector("[data-last-refresh]")?.textContent).toBe("Never");
    expect(document.querySelector("[data-start]")?.textContent).toBe("Start collecting");
  });

  it("disables export and clear actions when there are no records", () => {
    renderSnapshot(document.body, {
      ...snapshot,
      run: { ...snapshot.run, state: "idle", totalUnique: 0 },
    });

    expect(
      (document.querySelector("[data-export-csv]") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (document.querySelector("[data-clear]") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("renderRecoverableNotice", () => {
  it("shows a paused notice without turning an active run into a blocked state", () => {
    renderSnapshot(document.body, snapshot);
    renderRecoverableNotice(document.body, "Return to the Connections tab to continue.");

    expect(document.querySelector("[data-status]")?.textContent).toBe("Paused");
    expect(document.querySelector("[data-status]")?.getAttribute("data-state")).toBe("paused");
    expect(document.querySelector("[data-message]")?.textContent).toBe(
      "Return to the Connections tab to continue.",
    );
  });
});

describe("readCollectorSettings", () => {
  it("converts valid record and minute limits to bounded settings", () => {
    expect(readCollectorSettings(document.body)).toEqual({
      maxRecords: 1000,
      maxDurationMs: 1_800_000,
      renderTimeoutMs: 2_500,
      maxNoGrowthCycles: 3,
      maxFailureRatioCycles: 2,
    });
  });

  it("rejects invalid or excessive limits", () => {
    (
      document.querySelector("[data-max-records]") as HTMLInputElement
    ).value = "0";
    expect(() => readCollectorSettings(document.body)).toThrow(
      "Max records must be between 1 and 20,000.",
    );
  });
});

describe("shouldInitializePopup", () => {
  it("initializes only inside a Chrome extension page", () => {
    expect(shouldInitializePopup("http:")).toBe(false);
    expect(shouldInitializePopup("chrome-extension:")).toBe(true);
  });
});
