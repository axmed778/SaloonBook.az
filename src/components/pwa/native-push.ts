"use client";

// Notifications inside the App Store app (Capacitor shell, see
// capacitor.config.ts). WKWebView has no Web Push, so the app registers with
// APNs through @capacitor/push-notifications and hands the device token to
// /api/push/native. The Capacitor modules are imported lazily: browsers never
// download them.
import { isNativeAppUserAgent } from "@/lib/native-app";

export function isNativeApp(): boolean {
  return typeof navigator !== "undefined" && isNativeAppUserAgent(navigator.userAgent);
}

// The token this phone last registered, so "on" survives reloads and "off" can
// tell the server which row to delete.
const TOKEN_KEY = "sb.apnsToken";

function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked: the toggle just shows "off" after a reload.
  }
}

async function plugin() {
  return (await import("@capacitor/push-notifications")).PushNotifications;
}

export type NativePushState = "on" | "off" | "denied";

export async function nativePushState(): Promise<NativePushState> {
  const push = await plugin();
  const { receive } = await push.checkPermissions();
  if (receive === "denied") return "denied";
  return receive === "granted" && storedToken() ? "on" : "off";
}

async function saveToken(token: string): Promise<void> {
  const res = await fetch("/api/push/native", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(`token save failed (${res.status})`);
  storeToken(token);
}

/** Ask APNs for this phone's token (resolves once iOS hands it over). */
async function registerForToken(): Promise<string> {
  const push = await plugin();
  let resolve!: (token: string) => void;
  let reject!: (e: Error) => void;
  const token = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Listen before registering, so the event can't fire unheard.
  const handles = await Promise.all([
    push.addListener("registration", (t) => resolve(t.value)),
    push.addListener("registrationError", (e) => reject(new Error(e.error))),
  ]);
  const timer = setTimeout(() => reject(new Error("APNs registration timed out")), 20_000);
  try {
    await push.register();
    return await token;
  } finally {
    clearTimeout(timer);
    for (const h of handles) await h.remove();
  }
}

export async function enableNativePush(): Promise<NativePushState> {
  const push = await plugin();
  const { receive } = await push.requestPermissions();
  if (receive !== "granted") return receive === "denied" ? "denied" : "off";
  await saveToken(await registerForToken());
  return "on";
}

export async function disableNativePush(): Promise<void> {
  const token = storedToken();
  if (token) {
    await fetch("/api/push/native", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  }
  storeToken(null);
  await (await plugin()).unregister();
}

/**
 * App-wide wiring, mounted once in the dashboard: opens the page a tapped
 * notification points at, and re-sends the token on launch (iOS can rotate it,
 * and the row may have moved to another branch or user).
 */
export async function startNativePush(): Promise<() => void> {
  const push = await plugin();
  const tap = await push.addListener("pushNotificationActionPerformed", (action) => {
    const url = (action.notification.data as { url?: unknown } | undefined)?.url;
    if (typeof url !== "string") return;
    try {
      const target = new URL(url, window.location.href);
      if (target.origin === window.location.origin) window.location.assign(target.href);
    } catch {
      // Malformed url: stay where we are.
    }
  });

  if (storedToken()) {
    const { receive } = await push.checkPermissions();
    if (receive === "granted") {
      registerForToken()
        .then(saveToken)
        .catch((e) => console.error("[push] native token refresh failed", e));
    }
  }

  return () => void tap.remove();
}
