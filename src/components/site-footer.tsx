import { Logo } from "@/components/site-header";

const COLUMNS = [
  {
    title: "Məhsul",
    links: [
      { label: "İmkanlar", href: "#features" },
      { label: "Qiymətlər", href: "#pricing" },
      { label: "Nümunə səhifə", href: "/demostudio" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  {
    title: "Şirkət",
    links: [
      { label: "Haqqımızda", href: "#" },
      { label: "Əlaqə", href: "#" },
      { label: "Gizlilik", href: "#" },
      { label: "Şərtlər", href: "#" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="flex flex-col justify-between gap-10 md:flex-row">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Azərbaycan salonları, bərbərxanalar və klinikalar üçün onlayn
              qeydiyyat. Müştərilər özləri yer ayırsın — 24/7.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-12 sm:gap-20">
            {COLUMNS.map((col) => (
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
          <p>Bakıda hazırlanıb · Asia/Baku (UTC+4)</p>
        </div>
      </div>
    </footer>
  );
}
