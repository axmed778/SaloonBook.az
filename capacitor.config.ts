import type { CapacitorConfig } from "@capacitor/cli";

// iOS App Store shell. The app is the live site (server.url), not a bundled
// export: the dashboard runs on server actions, so it can only work against the
// real server. webDir holds just the offline fallback page Capacitor needs.
//
// appendUserAgent lets the server tell the app apart from Safari (see
// src/lib/native-app.ts): the billing page hides purchase CTAs inside the app.
const config: CapacitorConfig = {
  appId: "az.salonbook.app",
  appName: "SalonBook",
  webDir: "mobile/www",
  server: {
    url: "https://salonbook.az/dashboard",
    // Links to any other host (WhatsApp, Instagram, maps) open in Safari.
    allowNavigation: ["salonbook.az", "www.salonbook.az"],
    errorPath: "offline.html",
  },
  appendUserAgent: "SalonBookApp/ios",
  backgroundColor: "#09090b",
  ios: {
    contentInset: "never",
    scheme: "SalonBook",
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
