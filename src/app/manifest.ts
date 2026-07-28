import type { MetadataRoute } from "next";

// Web App Manifest, served at /manifest.webmanifest and auto-linked by Next into
// every page's <head>. Colors match the app's default (dark) theme tokens in
// globals.css. start_url is the owner dashboard: installing to the home screen is
// a salon-owner tool, so the app opens straight into "Bu gün". Azerbaijani is the
// default locale (unprefixed), so "/dashboard" resolves without a locale segment.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SalonBook.az — Book · Manage · Grow",
    short_name: "SalonBook",
    description:
      "Salonunuzu idarə edin: bugünkü görüşlər, təqvim, müştərilər və bildirişlər — bir toxunuşla.",
    id: "/dashboard",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "az",
    dir: "ltr",
    categories: ["business", "productivity", "lifestyle"],
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
