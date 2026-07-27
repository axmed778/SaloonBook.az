"use client";

// Landing-page discovery map: every salon that has pinned a location shows up
// as a marker; tapping one opens a popup with a "Book" button that links
// straight to that salon's booking page — no shared link needed.
//
// Leaflet touches `window`, so its runtime is imported lazily inside the effect
// (never during SSR). The stylesheet is a static import (pure CSS side-effect,
// safe on the server). Dark-mode tile theming lives in globals.css.

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MapPin } from "lucide-react";
import { BAKU_CENTER, BAKU_ZOOM, osmTileLayer, pinIcon } from "./map/leaflet-setup";

type SalonPin = {
  slug: string;
  name: string;
  address: string | null;
  audience: "MALE" | "FEMALE" | "ALL";
  lat: number;
  lng: number;
};

type LeafletMap = import("leaflet").Map;

/** Build the popup as DOM nodes (textContent) so salon-supplied name/address
 *  can never inject markup into the map. */
function buildPopup(salon: SalonPin, href: string, bookLabel: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "salon-popup";

  const name = document.createElement("p");
  name.className = "salon-popup-name";
  name.textContent = salon.name;
  wrap.appendChild(name);

  if (salon.address) {
    const addr = document.createElement("p");
    addr.className = "salon-popup-addr";
    addr.textContent = salon.address;
    wrap.appendChild(addr);
  }

  const book = document.createElement("a");
  book.className = "salon-popup-book";
  book.href = href;
  book.textContent = bookLabel;
  wrap.appendChild(book);

  return wrap;
}

export function SalonMap() {
  const t = useTranslations("Landing.map");
  const locale = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  const [salons, setSalons] = useState<SalonPin[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reloadKey, setReloadKey] = useState(0);

  // Fetch the marker set (public, cached endpoint).
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetch("/api/public/salons")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { salons: SalonPin[] }) => {
        if (cancelled) return;
        setSalons(data.salons ?? []);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Build the Leaflet map once the data (and container) are ready.
  useEffect(() => {
    if (!salons || !containerRef.current) return;
    // az is the un-prefixed default locale; en/ru carry a path prefix.
    const prefix = locale === "az" ? "" : `/${locale}`;

    let map: LeafletMap | undefined;
    let disposed = false;

    import("leaflet").then((mod) => {
      if (disposed || !containerRef.current) return;
      const L = mod.default ?? mod;

      map = L.map(containerRef.current, {
        scrollWheelZoom: false, // don't hijack page scroll on the landing page
        zoomControl: true,
        center: BAKU_CENTER,
        zoom: BAKU_ZOOM,
      });
      map.attributionControl.setPrefix("");
      osmTileLayer(L).addTo(map);

      const icon = pinIcon(L);
      const points: [number, number][] = [];
      for (const s of salons) {
        const marker = L.marker([s.lat, s.lng], { icon, title: s.name }).addTo(map);
        marker.bindPopup(buildPopup(s, `${prefix}/${s.slug}`, t("book")), {
          closeButton: true,
          minWidth: 180,
        });
        points.push([s.lat, s.lng]);
      }
      if (points.length > 0) {
        map.fitBounds(points, { padding: [48, 48], maxZoom: 14 });
      }
      // A tab/layout can size the container after init; settle the tiles.
      setTimeout(() => map?.invalidateSize(), 0);
    });

    return () => {
      disposed = true;
      map?.remove();
    };
  }, [salons, locale, t]);

  const isEmpty = status === "ready" && salons?.length === 0;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-muted shadow-soft">
      <div
        ref={containerRef}
        className="h-[70vh] max-h-[560px] min-h-[420px] w-full"
        role="application"
        aria-label={t("ariaLabel")}
      />

      {status === "loading" && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-muted/80 text-sm text-muted-foreground backdrop-blur-sm">
          {t("loading")}
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 z-[500] flex flex-col items-center justify-center gap-3 bg-muted/90 px-6 text-center">
          <p className="text-sm text-muted-foreground">{t("error")}</p>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-hover"
          >
            {t("retry")}
          </button>
        </div>
      )}

      {isEmpty && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[500] flex justify-center px-4">
          <p className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-2 text-sm text-muted-foreground shadow-soft backdrop-blur">
            <MapPin className="h-4 w-4 text-accent" strokeWidth={2} />
            {t("empty")}
          </p>
        </div>
      )}
    </div>
  );
}
