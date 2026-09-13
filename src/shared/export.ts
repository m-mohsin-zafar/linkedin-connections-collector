import type { ConnectionRecord } from "./types";

export function sortRecords(
  records: ConnectionRecord[],
): ConnectionRecord[] {
  return [...records].sort(
    (left, right) =>
      left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
      }) || left.profileUrl.localeCompare(right.profileUrl),
  );
}

function safeCsvCell(value: string | null): string {
  let cell = value ?? "";
  if (/^[=+\-@]/.test(cell)) {
    cell = "'" + cell;
  }
  return '"' + cell.replaceAll('"', '""') + '"';
}

export function serializeCsv(records: ConnectionRecord[]): string {
  const fields: (keyof ConnectionRecord)[] = [
    "name",
    "headline",
    "profileUrl",
    "connectedOn",
    "collectedAt",
  ];
  const rows = [
    fields.map((field) => safeCsvCell(field)).join(","),
    ...sortRecords(records).map((record) =>
      fields.map((field) => safeCsvCell(record[field])).join(","),
    ),
  ];
  return "\uFEFF" + rows.join("\r\n");
}

export function serializeJson(
  records: ConnectionRecord[],
  exportedAt: string,
): string {
  return (
    JSON.stringify(
      {
        schemaVersion: 1,
        exportedAt,
        recordCount: records.length,
        connections: sortRecords(records),
      },
      null,
      2,
    ) + "\n"
  );
}
