import { cookies } from "next/headers";
import { hasLocale } from "next-intl";
import { routing, type Locale } from "./routing";

// Resolve the caller's locale for API routes and other server code OUTSIDE the
// [locale] segment (where next-intl can't infer it from the request path).
// next-intl persists the chosen locale in the NEXT_LOCALE cookie, which the
// browser sends with every request — including /api calls.
export async function localeFromCookie(): Promise<Locale> {
  const value = (await cookies()).get("NEXT_LOCALE")?.value;
  return hasLocale(routing.locales, value) ? value : routing.defaultLocale;
}
