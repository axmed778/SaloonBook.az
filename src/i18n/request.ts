import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

// Per-request i18n config. Next-intl calls this on the server for every request
// to resolve the active locale and load its message dictionary. `requestLocale`
// comes from the [locale] segment; fall back to the default for anything the
// middleware let through that isn't a known locale.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
