import { describe, expect, it } from "vitest";
import {
  canonicalizeProfileUrl,
  mergeRecords,
  normalizeCandidate,
} from "../src/shared/records";

describe("canonicalizeProfileUrl", () => {
  it("removes tracking data from a LinkedIn member URL", () => {
    expect(
      canonicalizeProfileUrl(
        "https://www.linkedin.com/in/ada-lovelace/?trk=abc#section",
      ),
    ).toBe("https://www.linkedin.com/in/ada-lovelace");
  });

  it("normalizes relative member URLs onto the canonical host", () => {
    expect(canonicalizeProfileUrl("/in/grace-hopper/")).toBe(
      "https://www.linkedin.com/in/grace-hopper",
    );
  });

  it("rejects external and non-member URLs", () => {
    expect(canonicalizeProfileUrl("https://example.com/in/ada")).toBeNull();
    expect(
      canonicalizeProfileUrl("https://www.linkedin.com/company/openai"),
    ).toBeNull();
  });
});

describe("normalizeCandidate", () => {
  it("trims display fields and fills missing optional values with null", () => {
    expect(
      normalizeCandidate(
        {
          name: " Ada Lovelace ",
          headline: " Engineer ",
          profileUrl: "https://linkedin.com/in/ada/",
        },
        "2026-09-13T00:00:00.000Z",
      ),
    ).toEqual({
      name: "Ada Lovelace",
      headline: "Engineer",
      profileUrl: "https://www.linkedin.com/in/ada",
      connectedOn: null,
      collectedAt: "2026-09-13T00:00:00.000Z",
    });
  });

  it("rejects candidates without both a name and valid profile URL", () => {
    expect(
      normalizeCandidate(
        { name: " ", profileUrl: "https://linkedin.com/in/ada" },
        "2026-09-13T00:00:00.000Z",
      ),
    ).toBeNull();
    expect(
      normalizeCandidate(
        { name: "Ada", profileUrl: "https://linkedin.com/feed" },
        "2026-09-13T00:00:00.000Z",
      ),
    ).toBeNull();
  });
});

describe("mergeRecords", () => {
  it("deduplicates by URL, fills blanks, and keeps the earliest timestamp", () => {
    const result = mergeRecords(
      [
        {
          name: "Ada",
          headline: null,
          profileUrl: "https://www.linkedin.com/in/ada",
          connectedOn: null,
          collectedAt: "2026-09-13T00:00:00.000Z",
        },
      ],
      [
        {
          name: "Ada Lovelace",
          headline: "Engineer",
          profileUrl: "https://www.linkedin.com/in/ada",
          connectedOn: "Connected August 2026",
          collectedAt: "2026-09-14T00:00:00.000Z",
        },
      ],
    );

    expect(result.added).toBe(0);
    expect(result.duplicates).toBe(1);
    expect(result.records).toEqual([
      {
        name: "Ada",
        headline: "Engineer",
        profileUrl: "https://www.linkedin.com/in/ada",
        connectedOn: "Connected August 2026",
        collectedAt: "2026-09-13T00:00:00.000Z",
      },
    ]);
  });

  it("adds records with new canonical profile URLs", () => {
    const incoming = [
      {
        name: "Grace Hopper",
        headline: null,
        profileUrl: "https://www.linkedin.com/in/grace",
        connectedOn: null,
        collectedAt: "2026-09-13T00:00:00.000Z",
      },
    ];
    expect(mergeRecords([], incoming)).toEqual({
      records: incoming,
      added: 1,
      duplicates: 0,
    });
  });
});
