import { defineRouting } from "next-intl/routing";

// Locale routing config, shared by the middleware, the navigation helpers
// (src/i18n/navigation.ts) and the request config (src/i18n/request.ts).
//   - defaultLocale "az": Azerbaijani stays on the un-prefixed URLs, so every
//     link a salon has already shared (/my-salon, /dashboard) keeps working.
//   - localePrefix "as-needed": only en/ru get a /en, /ru prefix.
//   - localeDetection false: a shared salon link must open in AZ, not silently
//     redirect to the visitor's browser language (which would surprise the
//     salon owner testing their own link). The visitor switches explicitly via
//     the language switcher; that choice is then remembered in the cookie.
export const routing = defineRouting({
  locales: ["az", "en", "ru"],
  defaultLocale: "az",
  localePrefix: "as-needed",
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];
