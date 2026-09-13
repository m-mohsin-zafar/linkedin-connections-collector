import { describe, expect, it } from "vitest";
import { serializeCsv, serializeJson } from "../src/shared/export";
import type { ConnectionRecord } from "../src/shared/types";

const dangerousRecord: ConnectionRecord = {
  name: '=HYPERLINK("https://bad.example")',
  headline: 'Builder, "tools"',
  profileUrl: "https://www.linkedin.com/in/ada",
  connectedOn: null,
  collectedAt: "2026-09-13T00:00:00.000Z",
};

describe("serializeCsv", () => {
  it("quotes fields and neutralizes spreadsheet formulas", () => {
    const csv = serializeCsv([dangerousRecord]);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""https://bad.example"")"');
    expect(csv).toContain('"Builder, ""tools"""');
  });

  it("sorts records by name and profile URL without mutating input", () => {
    const records: ConnectionRecord[] = [
      {
        ...dangerousRecord,
        name: "Zoe",
        profileUrl: "https://www.linkedin.com/in/zoe",
      },
      {
        ...dangerousRecord,
        name: "ada",
        profileUrl: "https://www.linkedin.com/in/ada",
      },
    ];

    const csv = serializeCsv(records);
    expect(csv.indexOf('"ada"')).toBeLessThan(csv.indexOf('"Zoe"'));
    expect(records[0]?.name).toBe("Zoe");
  });
});

describe("serializeJson", () => {
  it("emits versioned metadata and normalized records", () => {
    const parsed = JSON.parse(
      serializeJson([dangerousRecord], "2026-09-14T00:00:00.000Z"),
    );

    expect(parsed).toMatchObject({
      schemaVersion: 1,
      exportedAt: "2026-09-14T00:00:00.000Z",
      recordCount: 1,
    });
    expect(parsed.connections).toEqual([dangerousRecord]);
  });

  it("ends pretty-printed JSON with a newline", () => {
    const json = serializeJson([], "2026-09-14T00:00:00.000Z");
    expect(json).toContain("\n  \"schemaVersion\": 1,");
    expect(json.endsWith("\n")).toBe(true);
  });
});
