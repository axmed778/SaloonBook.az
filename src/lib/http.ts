// Timeouts for outgoing HTTP calls.
//
// There were none. Node's undici defaults to a 300-second headers timeout, so a
// provider that accepted a connection and then stalled held our request handler
// for five minutes. In a request path that is an availability bug, not a latency
// one: /api/client/otp/request awaits the Graph API inline, so a few dozen
// sign-in attempts during a Meta stall exhaust the server's concurrency and take
// the whole site down with them — booking pages included. The same applies to
// Turnstile on the booking path, which additionally fails closed, so a stalled
// verifier turns into refused bookings.
//
// Every fetch that leaves this process must pass one of these as `signal`.

/**
 * Default for third-party APIs we call inline while a user waits (Resend,
 * Twilio, Cloudflare Turnstile). Long enough to absorb a slow but healthy
 * response, short enough that a stalled provider cannot pin a request handler.
 */
export const HTTP_TIMEOUT_MS = 8_000;

/**
 * Meta's Graph API, which is routinely slower than the others and is called from
 * the worker, where a retry is cheap.
 */
export const GRAPH_TIMEOUT_MS = 10_000;

// A timed-out fetch rejects, and every call site already treats a rejection as
// the retryable case it is: the notification processor lets it fail the job so
// BullMQ retries with backoff, the OTP sender falls back to SMS, and Turnstile
// fails closed on purpose. So no special-casing of TimeoutError is needed
// anywhere — the timeout simply converts a five-minute hang into a prompt error
// on a path that already knew what to do with one.
