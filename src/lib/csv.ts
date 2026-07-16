// Minimal RFC 4180 CSV builder, tuned for spreadsheets. We prepend a UTF-8 BOM
// and use CRLF line endings so Excel opens Azerbaijani/Cyrillic text correctly
// (without the BOM it guesses ANSI and mangles ə, ş, я, …), and we neutralize
// spreadsheet formula injection on every cell.

type Cell = string | number | null | undefined;

/** UTF-8 byte-order mark; makes Excel read the file as UTF-8, not ANSI. */
const BOM = String.fromCharCode(0xfeff);

/** Escape+quote one cell, neutralizing spreadsheet formula injection. */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // A leading =, +, -, @ (or a control char) makes Excel/Sheets evaluate the
  // cell as a formula — dangerous for customer-controlled text (names, notes
  // arrive from the public booking page). Prefix an apostrophe: spreadsheets
  // treat it as the "force text" marker and hide it. Phone numbers (+994…) get
  // it too and still display fine.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  const escaped = s.replace(/"/g, '""');
  return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

/** Build a full CSV document (BOM + header + rows) from a header row and cells. */
export function toCsv(headers: Cell[], rows: Cell[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  return BOM + lines.join("\r\n") + "\r\n";
}
