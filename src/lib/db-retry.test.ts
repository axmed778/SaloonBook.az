import { afterEach, describe, expect, it, vi } from "vitest";
import { DB_RETRY_ATTEMPTS, isDbUnreachable, withDbRetry } from "./db-retry";

// No real waiting: the delay is asserted through the injected sleep instead.
const noSleep = () => Promise.resolve();

function prismaError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/** What a suspended Neon compute actually produces on the waking query. */
function coldNeon(): Error & { code: string } {
  return prismaError(
    "P1001",
    "Can't reach database server at `ep-example-pooler.eu-central-1.aws.neon.tech:5432`",
  );
}

afterEach(() => vi.restoreAllMocks());

describe("isDbUnreachable", () => {
  it("recognises a cold Neon compute", () => {
    expect(isDbUnreachable(coldNeon())).toBe(true);
  });

  it("recognises the message alone, with no Prisma error code", () => {
    // A failure during client initialisation carries no `code`.
    expect(isDbUnreachable(new Error("Can't reach database server at host:5432"))).toBe(true);
    expect(
      isDbUnreachable(
        Object.assign(new Error("boom"), { name: "PrismaClientInitializationError" }),
      ),
    ).toBe(true);
    expect(
      isDbUnreachable(new Error("Error in PostgreSQL connection: Error { kind: Closed }")),
    ).toBe(true);
  });

  it("does not retry an error the query itself caused", () => {
    // Retrying these can only fail again, and for a write it could double-apply.
    expect(isDbUnreachable(prismaError("P2002", "Unique constraint failed"))).toBe(false);
    expect(isDbUnreachable(prismaError("P2025", "Record to update not found"))).toBe(false);
    expect(isDbUnreachable(new Error("Invalid `prisma.igThread.findMany()` invocation"))).toBe(
      false,
    );
    expect(isDbUnreachable(undefined)).toBe(false);
  });
});

describe("withDbRetry", () => {
  it("returns the first result without sleeping when the database is up", async () => {
    const sleep = vi.fn(noSleep);
    const run = vi.fn().mockResolvedValue("threads");

    await expect(withDbRetry("ig-digest", run, { sleep })).resolves.toBe("threads");
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("survives a cold start: fails once, then succeeds", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sleep = vi.fn(noSleep);
    const run = vi.fn().mockRejectedValueOnce(coldNeon()).mockResolvedValue("threads");

    await expect(withDbRetry("ig-digest", run, { sleep, delayMs: 4_000 })).resolves.toBe(
      "threads",
    );
    expect(run).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(4_000);
  });

  it("gives up after the attempt cap and rethrows the last error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sleep = vi.fn(noSleep);
    const run = vi.fn().mockRejectedValue(coldNeon());

    await expect(withDbRetry("ig-digest", run, { sleep })).rejects.toThrow(
      /Can't reach database server/,
    );
    expect(run).toHaveBeenCalledTimes(DB_RETRY_ATTEMPTS);
    // One sleep fewer than attempts: no pause after the final failure.
    expect(sleep).toHaveBeenCalledTimes(DB_RETRY_ATTEMPTS - 1);
  });

  it("rethrows a non-connectivity error immediately", async () => {
    const sleep = vi.fn(noSleep);
    const run = vi.fn().mockRejectedValue(prismaError("P2002", "Unique constraint failed"));

    await expect(withDbRetry("ig-digest", run, { sleep })).rejects.toThrow(
      /Unique constraint/,
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("names the caller in the retry warning, so a log says which job waited", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = vi.fn().mockRejectedValueOnce(coldNeon()).mockResolvedValue(null);

    await withDbRetry("ig-digest", run, { sleep: noSleep });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[ig-digest]"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("attempt 1/3"));
  });
});
