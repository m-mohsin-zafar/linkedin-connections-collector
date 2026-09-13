import type {
  ConnectionCandidate,
  ConnectionRecord,
  MergeResult,
} from "./types";

function cleanText(value: string | null | undefined): string | null {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned : null;
}

export function canonicalizeProfileUrl(value: string): string | null {
  try {
    const url = new URL(value, "https://www.linkedin.com");
    if (!/^(www\.)?linkedin\.com$/i.test(url.hostname)) {
      return null;
    }

    const match = url.pathname.match(/^\/in\/([^/]+)\/?$/i);
    if (!match?.[1]) {
      return null;
    }

    return "https://www.linkedin.com/in/" + match[1];
  } catch {
    return null;
  }
}

export function normalizeCandidate(
  candidate: ConnectionCandidate,
  collectedAt: string,
): ConnectionRecord | null {
  const name = cleanText(candidate.name);
  const profileUrl = canonicalizeProfileUrl(candidate.profileUrl);
  if (!name || !profileUrl) {
    return null;
  }

  return {
    name,
    headline: cleanText(candidate.headline),
    profileUrl,
    connectedOn: cleanText(candidate.connectedOn),
    collectedAt,
  };
}

export function mergeRecords(
  existing: ConnectionRecord[],
  incoming: ConnectionRecord[],
): MergeResult {
  const byProfileUrl = new Map(
    existing.map((record) => [record.profileUrl, { ...record }]),
  );
  let added = 0;
  let duplicates = 0;

  for (const record of incoming) {
    const current = byProfileUrl.get(record.profileUrl);
    if (!current) {
      byProfileUrl.set(record.profileUrl, { ...record });
      added += 1;
      continue;
    }

    duplicates += 1;
    current.headline ||= record.headline;
    current.connectedOn ||= record.connectedOn;
    if (record.collectedAt < current.collectedAt) {
      current.collectedAt = record.collectedAt;
    }
  }

  return {
    records: [...byProfileUrl.values()],
    added,
    duplicates,
  };
}
