import { csvCell } from "@/lib/csv";

// Streaming CSV for the PRO data exports. Private to the export routes (the
// leading underscore keeps the folder out of Next's route tree).
//
// WHY this exists rather than `toCsv(headers, rows)`: the exports used to load
// the entire result set into memory inside ONE withTenantScope transaction, and
// "all time" has no upper bound. That is two problems at once — the array grows
// with the salon's whole history, and a pooled Neon connection is pinned for the
// full 20-second interactive-transaction budget while the CSV is built and the
// bytes are handed to the client. Here the rows are fetched in bounded batches,
// each in its own SHORT transaction, and serialized straight into the response
// body, so peak memory is one batch and no connection is held between batches.

type Cell = string | number | null | undefined;

/** UTF-8 BOM; makes Excel read the file as UTF-8, not ANSI. Same as lib/csv. */
const BOM = String.fromCharCode(0xfeff);

/**
 * Hard ceiling on a single export. Not a performance guess — it is the point
 * past which a CSV stops being a spreadsheet a salon owner can open (Excel's
 * own limit is ~1M rows, but a browser download of tens of MB over a phone
 * connection fails long before that) and starts being a database dump that
 * should go through support instead. ~50k rows is roughly a decade of bookings
 * for a busy salon, so no real account reaches it by accident.
 */
export const MAX_EXPORT_ROWS = 50_000;

/**
 * Rows per batch. Big enough that a full-history export is tens of queries, not
 * thousands; small enough that one batch is a few hundred KB of strings and
 * each transaction is milliseconds rather than seconds.
 */
export const EXPORT_BATCH_SIZE = 1_000;

function line(cells: Cell[]): string {
  return cells.map(csvCell).join(",") + "\r\n";
}

/**
 * Builds the streaming CSV response.
 *
 * `nextBatch` is called repeatedly and must return the next chunk of rows,
 * advancing its own cursor; an empty array ends the file. It runs OUTSIDE any
 * transaction the caller previously opened — open a short one inside it.
 */
export function csvStreamResponse(opts: {
  filename: string;
  headers: Cell[];
  nextBatch: () => Promise<Cell[][]>;
}): Response {
  const encoder = new TextEncoder();
  let headerSent = false;
  let emitted = 0;

  const body = new ReadableStream<Uint8Array>({
    // `pull` rather than a loop in `start`: the stream only asks for the next
    // batch once the previous one has been consumed, so a slow client throttles
    // the queries instead of letting them race ahead into memory.
    async pull(controller) {
      try {
        if (!headerSent) {
          headerSent = true;
          controller.enqueue(encoder.encode(BOM + line(opts.headers)));
          return;
        }

        const rows = await opts.nextBatch();
        if (rows.length === 0) {
          controller.close();
          return;
        }

        emitted += rows.length;
        controller.enqueue(encoder.encode(rows.map(line).join("")));

        // Short batch => the source is exhausted. The row ceiling is enforced
        // before streaming starts (the caller counts first and refuses with a
        // translated error), so hitting it here means rows were written while
        // the export ran — stop rather than follow a moving target.
        if (rows.length < EXPORT_BATCH_SIZE || emitted >= MAX_EXPORT_ROWS) {
          controller.close();
        }
      } catch (err) {
        // The status line and headers are long gone by now, so there is no way
        // to turn this into a 500 — erroring the stream aborts the transfer,
        // which the browser surfaces as a failed download rather than handing
        // the owner a silently truncated file.
        console.error("[export] stream aborted:", err);
        controller.error(err);
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${opts.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
