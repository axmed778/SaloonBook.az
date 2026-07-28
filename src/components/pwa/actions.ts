"use server";

import { cookies } from "next/headers";
import { A2HS_DISMISS_COOKIE } from "./constants";

// Persist the "Add to Home Screen" dismissal server-side (a cookie), so the
// prompt stays hidden across reloads and devices sharing the session — not only
// in localStorage (which a re-install / cleared storage would forget, and which
// the brief explicitly rules out as the sole store).
export async function dismissInstallPrompt(): Promise<void> {
  const store = await cookies();
  store.set(A2HS_DISMISS_COOKIE, "1", {
    httpOnly: true, // only the server (dashboard layout) reads it
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // ~1 year
  });
}
