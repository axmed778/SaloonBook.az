// Server-side Web Push sender (worker-only). Thin wrapper over the `web-push`
// library + VAPID config. Like whatsapp.ts, it runs in a "sandbox" (log-only)
// mode when VAPID keys are absent, so local dev needs no keys and never fails.
//
// web-push is listed in next.config serverExternalPackages so it never bundles
// into a client build.
import webpush from "web-push";

// Configured lazily on first send (env is read once). null = not yet checked.
let configured: boolean | null = null;

function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  // A `mailto:` (or https) contact Meta/push services can reach about the sender.
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:admin@salonbook.az";
  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Where clicking the notification should open (path or absolute URL). */
  url?: string;
  /** Collapse key: a newer notification with the same tag replaces the older. */
  tag?: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushResult =
  | { ok: true; sandbox?: boolean }
  // gone = 404/410: the subscription is permanently dead; caller should delete it.
  | { ok: false; gone: boolean; statusCode?: number };

/** Send one push message to one subscription. Never throws. */
export async function sendWebPush(target: PushTarget, message: PushMessage): Promise<PushResult> {
  if (!ensureConfigured()) {
    console.log(`[push:sandbox] -> ${target.endpoint.slice(0, 48)}… ${message.title}`);
    return { ok: true, sandbox: true };
  }
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(message),
      { TTL: 3600, urgency: "high" },
    );
    return { ok: true };
  } catch (e) {
    const statusCode = (e as { statusCode?: number }).statusCode;
    const gone = statusCode === 404 || statusCode === 410;
    if (!gone) {
      console.error(`[push] send failed (${statusCode ?? "?"}): ${(e as Error).message}`);
    }
    return { ok: false, gone, statusCode };
  }
}
