// The App Store app is a Capacitor shell around the live site (see
// capacitor.config.ts). It appends this marker to WKWebView's user agent, so
// both the server (request header) and the client (navigator.userAgent) can
// tell the app apart from Safari.
export const NATIVE_APP_UA_MARKER = "SalonBookApp/ios";

export function isNativeAppUserAgent(userAgent: string | null | undefined): boolean {
  return !!userAgent && userAgent.includes(NATIVE_APP_UA_MARKER);
}
