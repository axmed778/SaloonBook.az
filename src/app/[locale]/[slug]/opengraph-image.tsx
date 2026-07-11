import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { intlLocale } from "@/i18n/format";

// Per-salon Open Graph image (1200×630), rendered on demand. Next picks this
// up automatically for /{slug} — shared booking links preview with the salon's
// own name instead of generic boilerplate.

export const runtime = "nodejs";
export const alt = "Onlayn qeydiyyat — SalonBook.az";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const initials = (name: string, df: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase(df);

export default async function OgImage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const df = intlLocale(locale);
  const t = await getTranslations({ locale, namespace: "SalonPage" });
  const salon = await prisma.salon.findUnique({
    where: { slug },
    select: { name: true, address: true, status: true },
  });
  const name = salon && salon.status === "ACTIVE" ? salon.name : "SalonBook.az";
  const address = salon?.status === "ACTIVE" ? salon.address : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(135deg, #0d0d0f 0%, #1c0f16 55%, #3b1226 100%)",
          color: "#fafafa",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "rgba(244, 63, 94, 0.18)",
              border: "1px solid rgba(244, 63, 94, 0.45)",
              color: "#fda4af",
              fontSize: 26,
              fontWeight: 700,
            }}
          >
            SB
          </div>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 600, color: "#e4e4e7" }}>
            SalonBook<span style={{ color: "#a1a1aa" }}>.az</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 110,
                height: 110,
                borderRadius: 28,
                background: "rgba(244, 63, 94, 0.14)",
                border: "1px solid rgba(244, 63, 94, 0.4)",
                color: "#fb7185",
                fontSize: 48,
                fontWeight: 700,
              }}
            >
              {initials(name, df)}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: name.length > 24 ? 56 : 72,
                fontWeight: 700,
                letterSpacing: -1,
                lineHeight: 1.05,
              }}
            >
              {name}
            </div>
          </div>
          {address && (
            <div style={{ display: "flex", fontSize: 30, color: "#a1a1aa" }}>{address}</div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 32,
            color: "#e4e4e7",
          }}
        >
          <div
            style={{
              display: "flex",
              width: 14,
              height: 14,
              borderRadius: 999,
              background: "#34d399",
            }}
          />
          {t("ogTagline")}
        </div>
      </div>
    ),
    size,
  );
}
