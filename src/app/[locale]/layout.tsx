import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { ogLocale } from "@/i18n/format";
import { ThemeSync } from "@/components/theme-sync";
import "../globals.css";

// Pre-render the three locales at build time.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const title = t("title");
  const description = t("description");
  // Site-wide defaults. metadataBase makes every relative OG/canonical URL below
  // (and in child pages) absolute. Per-page canonical/hreflang is set on the
  // pages that need it (home, salon, legal) — NOT here, so subpages don't all
  // inherit a homepage canonical. The default OG image is the product hero.
  return {
    metadataBase: new URL(appUrl),
    applicationName: "SalonBook.az",
    title: { default: title, template: "%s | SalonBook.az" },
    description,
    openGraph: {
      title,
      description,
      siteName: "SalonBook.az",
      locale: ogLocale(locale),
      type: "website",
      images: [{ url: "/hero/booking-dark.png", width: 1200, height: 630, alt: "SalonBook.az" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/hero/booking-dark.png"],
    },
    robots: { index: true, follow: true },
    icons: { icon: "/icon.svg" },
  };
}

// Runs before paint: applies the saved theme (or the OS preference) so there's
// no flash of the wrong theme. Kept tiny and dependency-free.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark';}var d=document.documentElement;d.classList.remove('light','dark');d.classList.add(t);}catch(e){}})();`;

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Enables static rendering for this request's locale.
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${GeistSans.variable} ${GeistMono.variable} dark`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <ThemeSync />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
