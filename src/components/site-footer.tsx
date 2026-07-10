import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/site-header";

export async function SiteFooter() {
  const t = await getTranslations("Footer");

  // Anchor links are rooted (/#…) so they also work from /privacy and /terms.
  const columns = [
    {
      title: t("productTitle"),
      links: [
        { label: t("features"), href: "/#features" },
        { label: t("pricing"), href: "/#pricing" },
        { label: t("demo"), href: "/demostudio" },
        { label: t("faq"), href: "/#faq" },
      ],
    },
    {
      title: t("companyTitle"),
      links: [
        { label: t("contact"), href: "https://wa.me/994502990440" },
        { label: t("privacy"), href: "/privacy" },
        { label: t("terms"), href: "/terms" },
      ],
    },
  ];

  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="flex flex-col justify-between gap-10 md:flex-row">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {t("tagline")}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-12 sm:gap-20">
            {columns.map((col) => (
              <div key={col.title}>
                <h3 className="text-sm font-medium text-foreground">{col.title}</h3>
                <ul className="mt-4 space-y-3">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} SalonBook.az</p>
          <p>{t("madeIn")}</p>
        </div>
      </div>
    </footer>
  );
}
