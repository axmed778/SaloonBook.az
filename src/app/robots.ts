import type { MetadataRoute } from "next";

// Site-wide crawler rules. Public marketing + salon booking pages are indexable;
// authenticated app surfaces, the API, and the unguessable self-service manage
// links (/a/{token}) are kept out of the index. Localized (/en, /ru) copies of
// the private areas are disallowed too — the default (az) prefix is unprefixed.
const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

const PRIVATE = [
  "/dashboard",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/a/", // customer self-service capability links — never index
  "/api/",
];

export default function robots(): MetadataRoute.Robots {
  const disallow = [
    ...PRIVATE,
    ...PRIVATE.filter((p) => p !== "/api/" && p !== "/a/").flatMap((p) => [`/en${p}`, `/ru${p}`]),
  ];
  return {
    rules: { userAgent: "*", allow: "/", disallow },
    sitemap: `${appUrl}/sitemap.xml`,
    host: appUrl,
  };
}
