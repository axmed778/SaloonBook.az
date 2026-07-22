import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalShell, Section, P, Ul, Li } from "@/components/legal-page";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Legal.dataDeletion" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

const CONTACT_WA = "+994 50 299 04 40";

// Section body blocks: a plain string is a paragraph, "__contact__" renders the
// contact paragraph (with the WhatsApp number), and an { items } object renders
// a bullet list. Mirrors the privacy/terms pages.
type Block = string | { items: string[] };
type Sec = { title: string; body: Block[] };

export default async function DataDeletionPage() {
  const t = await getTranslations("Legal.dataDeletion");
  const sections = t.raw("sections") as Sec[];

  return (
    <LegalShell title={t("title")} updated={t("updated")}>
      {sections.map((s, i) => (
        <Section key={i} title={s.title}>
          {s.body.map((b, j) =>
            typeof b === "string" ? (
              <P key={j}>{b === "__contact__" ? t("contactLine", { wa: CONTACT_WA }) : b}</P>
            ) : (
              <Ul key={j}>
                {b.items.map((it, k) => (
                  <Li key={k}>{it}</Li>
                ))}
              </Ul>
            ),
          )}
        </Section>
      ))}
    </LegalShell>
  );
}
