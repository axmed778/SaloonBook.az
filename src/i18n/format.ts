import type { Locale } from "./routing";

// BCP-47 tags for Intl.* formatting (dates, numbers), keyed by app locale.
const INTL_LOCALE: Record<Locale, string> = {
  az: "az-AZ",
  en: "en-US",
  ru: "ru-RU",
};

// Open Graph locale codes (underscored), keyed by app locale.
const OG_LOCALE: Record<Locale, string> = {
  az: "az_AZ",
  en: "en_US",
  ru: "ru_RU",
};

export function intlLocale(locale: string): string {
  return INTL_LOCALE[locale as Locale] ?? INTL_LOCALE.az;
}

export function ogLocale(locale: string): string {
  return OG_LOCALE[locale as Locale] ?? OG_LOCALE.az;
}
