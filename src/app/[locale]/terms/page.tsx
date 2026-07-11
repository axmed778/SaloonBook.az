import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LegalShell, Section, P, Ul, Li } from "@/components/legal-page";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Legal.terms" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

const CONTACT_WA = "+994 50 299 04 40";

// Section body blocks: a plain string is a paragraph; "__contact__" is the
// contact paragraph (with the WhatsApp number); "__privacyLink__" renders the
// paragraph that links to the Privacy Policy; { items } is a bullet list.
type Block = string | { items: string[] };
type Sec = { title: string; body: Block[] };

export default async function TermsPage() {
  const t = await getTranslations("Legal.terms");
  const sections = t.raw("sections") as Sec[];

  return (
    <LegalShell title={t("title")} updated={t("updated")}>
      {sections.map((s, i) => (
        <Section key={i} title={s.title}>
          {s.body.map((b, j) => {
            if (typeof b !== "string") {
              return (
                <Ul key={j}>
                  {b.items.map((it, k) => (
                    <Li key={k}>{it}</Li>
                  ))}
                </Ul>
              );
            }
            if (b === "__contact__") {
              return <P key={j}>{t("contactLine", { wa: CONTACT_WA })}</P>;
            }
            if (b === "__privacyLink__") {
              return (
                <P key={j}>
                  {t("privacyLink.before")}{" "}
                  <Link href="/privacy" className="text-accent underline underline-offset-2">
                    {t("privacyLink.link")}
                  </Link>{" "}
                  {t("privacyLink.after")}
                </P>
              );
            }
            return <P key={j}>{b}</P>;
          })}
        </Section>
      ))}
    </LegalShell>
  );
}
