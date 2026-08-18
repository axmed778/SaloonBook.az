"use client";

// Public discovery map: salons within the current viewport, clustered. Tapping a
// marker opens a bottom-sheet card with a Book link. Filters (category / open now
// / min rating) and "near me" (Geolocation, graceful denial) drive re-queries.
//
// Leaflet + the markercluster plugin touch `window`, so their runtime is imported
// lazily inside the effect (never during SSR); only their CSS is a static import.
// The @types/leaflet.markercluster augmentation is picked up automatically, so
// L.markerClusterGroup is typed. Location is used only client-side (viewport) and
// never sent anywhere but the bbox query.
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BAKU_CENTER, BAKU_ZOOM, osmTileLayer, pinIcon } from "./map/leaflet-setup";

type SalonPin = {
  slug: string;
  name: string;
  address: string | null;
  district: string | null;
  audience: "MALE" | "FEMALE" | "ALL";
  lat: number;
  lng: number;
  rating: number | null;
  ratingCount: number;
};

const CATEGORIES = ["HAIR", "NAILS", "BROWS_LASHES", "MAKEUP", "SPA", "BARBER", "OTHER"] as const;

export function DiscoveryMap() {
  const t = useTranslations("Discovery");
  const locale = useLocale();
  const prefix = locale === "az" ? "" : `/${locale}`;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const clusterRef = useRef<import("leaflet").MarkerClusterGroup | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  const iconRef = useRef<import("leaflet").DivIcon | null>(null);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pins, setPins] = useState<SalonPin[]>([]);
  const [selected, setSelected] = useState<SalonPin | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [geoDenied, setGeoDenied] = useState(false);

  const [category, setCategory] = useState("");
  const [openNow, setOpenNow] = useState(false);
  const [minRating, setMinRating] = useState(0);

  // Latest filters, read by the map's moveend handler (which closes over nothing).
  const filtersRef = useRef({ category, openNow, minRating });
  filtersRef.current = { category, openNow, minRating };

  const fetchInView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const params = new URLSearchParams({
      bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(","),
    });
    const f = filtersRef.current;
    if (f.category) params.set("category", f.category);
    if (f.openNow) params.set("openNow", "1");
    if (f.minRating > 0) params.set("minRating", String(f.minRating));

    setStatus("loading");
    fetch(`/api/public/salons/search?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { salons: SalonPin[]; truncated: boolean }) => {
        setPins(data.salons ?? []);
        setTruncated(!!data.truncated);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  const scheduleFetch = useCallback(() => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(fetchInView, 300);
  }, [fetchInView]);

  // Init the map + cluster layer once.
  useEffect(() => {
    let disposed = false;
    void (async () => {
      const mod = await import("leaflet");
      await import("leaflet.markercluster"); // augments L at runtime
      if (disposed || !containerRef.current) return;
      const L = (mod.default ?? mod) as typeof import("leaflet");
      LRef.current = L;

      const map = L.map(containerRef.current, {
        center: BAKU_CENTER,
        zoom: BAKU_ZOOM,
        zoomControl: true,
      });
      osmTileLayer(L).addTo(map);
      map.attributionControl.setPrefix("");

      const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 });
      map.addLayer(cluster);

      mapRef.current = map;
      clusterRef.current = cluster;
      iconRef.current = pinIcon(L);
      map.on("moveend", scheduleFetch);
      setTimeout(() => map.invalidateSize(), 0);
      fetchInView();
    })();

    return () => {
      disposed = true;
      if (fetchTimer.current) clearTimeout(fetchTimer.current);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [fetchInView, scheduleFetch]);

  // Re-query when a filter changes.
  useEffect(() => {
    if (mapRef.current) fetchInView();
  }, [category, openNow, minRating, fetchInView]);

  // Rebuild markers whenever the pin set changes.
  useEffect(() => {
    const L = LRef.current;
    const cluster = clusterRef.current;
    const icon = iconRef.current;
    if (!L || !cluster || !icon) return;
    cluster.clearLayers();
    for (const s of pins) {
      const marker = L.marker([s.lat, s.lng], { icon, title: s.name });
      marker.on("click", () => setSelected(s));
      cluster.addLayer(marker);
    }
  }, [pins]);

  function nearMe() {
    setGeoDenied(false);
    if (!("geolocation" in navigator)) {
      setGeoDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => mapRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 14),
      () => setGeoDenied(true),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  const selectCls =
    "rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-rose-500 focus:outline-none";

  return (
    <div className="relative isolate overflow-hidden rounded-xl border border-border bg-muted shadow-soft">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card/95 p-3 backdrop-blur">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={selectCls}
          aria-label={t("filters.category")}
        >
          <option value="">{t("filters.allCategories")}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`category.${c}`)}
            </option>
          ))}
        </select>

        <select
          value={minRating}
          onChange={(e) => setMinRating(Number(e.target.value))}
          className={selectCls}
          aria-label={t("filters.rating")}
        >
          <option value={0}>{t("filters.anyRating")}</option>
          {[3, 4, 4.5].map((r) => (
            <option key={r} value={r}>
              {t("filters.ratingPlus", { n: r })}
            </option>
          ))}
        </select>

        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-secondary-foreground">
          <input
            type="checkbox"
            checked={openNow}
            onChange={(e) => setOpenNow(e.target.checked)}
            className="h-4 w-4 rounded accent-rose-500"
          />
          {t("filters.openNow")}
        </label>

        <button
          onClick={nearMe}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-400"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          {t("filters.nearMe")}
        </button>
      </div>

      <div
        ref={containerRef}
        className="h-[68vh] max-h-[620px] min-h-[440px] w-full"
        role="application"
        aria-label={t("ariaLabel")}
      />

      {/* Status / truncation banners */}
      {status === "loading" && (
        <div className="pointer-events-none absolute right-3 top-16 z-[500] rounded-full bg-card/95 px-3 py-1 text-xs text-muted-foreground shadow-soft backdrop-blur">
          {t("loading")}
        </div>
      )}
      {truncated && status === "ready" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[500] flex justify-center px-4">
          <p className="pointer-events-auto rounded-full border border-border bg-card/95 px-4 py-2 text-xs text-muted-foreground shadow-soft backdrop-blur">
            {t("truncated")}
          </p>
        </div>
      )}
      {status === "ready" && pins.length === 0 && !truncated && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[500] flex justify-center px-4">
          <p className="pointer-events-auto rounded-full border border-border bg-card/95 px-4 py-2 text-xs text-muted-foreground shadow-soft backdrop-blur">
            {t("empty")}
          </p>
        </div>
      )}
      {geoDenied && (
        <div className="absolute inset-x-0 top-16 z-[500] flex justify-center px-4">
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 shadow-soft dark:text-amber-200">
            {t("geoDenied")}
          </p>
        </div>
      )}

      {/* Bottom-sheet salon card */}
      {selected && (
        <div className="absolute inset-x-0 bottom-0 z-[600] p-3">
          <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-4 shadow-frame">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-foreground">{selected.name}</p>
                {(selected.district || selected.address) && (
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {selected.district || selected.address}
                  </p>
                )}
                <p className="mt-1 text-sm text-faint-foreground">
                  {selected.rating !== null
                    ? `★ ${selected.rating.toFixed(1)} · ${t("reviews", { count: selected.ratingCount })}`
                    : t("noRating")}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                aria-label={t("close")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-hover hover:text-foreground"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <a
              href={`${prefix}/${selected.slug}`}
              className="mt-3 flex w-full items-center justify-center rounded-lg bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-400"
            >
              {t("book")}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
