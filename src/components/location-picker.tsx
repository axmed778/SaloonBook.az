"use client";

// Interactive location picker for Settings: the owner drops/drags a single pin
// on our own map (OpenStreetMap tiles via Leaflet — not Google), or taps "Use my
// location" to place it from the device GPS for street-level precision.
//
// Controlled component: the parent owns { lat, lng } and persists them. This
// reports every change up and mirrors the props back onto the marker (so a
// parent "clear" removes the pin). Leaflet's runtime is imported lazily so it
// never runs during SSR; the stylesheet is a static (server-safe) CSS import.

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Crosshair, LocateFixed } from "lucide-react";
import { BAKU_CENTER, osmTileLayer, pinIcon } from "./map/leaflet-setup";

type LeafletMap = import("leaflet").Map;
type LeafletMarker = import("leaflet").Marker;
type Leaflet = typeof import("leaflet");

type GeoStatus = "idle" | "locating" | "denied" | "unsupported" | "error";

/** ~11 cm precision — plenty for a storefront, and keeps the stored value tidy. */
const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function LocationPicker({
  lat,
  lng,
  onChange,
}: {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
}) {
  const t = useTranslations("Settings.location");
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | undefined>(undefined);
  const markerRef = useRef<LeafletMarker | undefined>(undefined);
  const LRef = useRef<Leaflet | undefined>(undefined);
  // Always call the latest onChange without re-running the mount effect.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Initial coords, captured for the mount-only view; live sync is separate.
  const initialRef = useRef({ lat, lng });

  const [geo, setGeo] = useState<GeoStatus>("idle");

  /** Create the marker if missing, otherwise move it. Keeps a single pin. */
  function placePin(L: Leaflet, map: LeafletMap, la: number, ln: number) {
    if (markerRef.current) {
      markerRef.current.setLatLng([la, ln]);
      return;
    }
    const m = L.marker([la, ln], { icon: pinIcon(L), draggable: true }).addTo(map);
    m.on("dragend", () => {
      const p = m.getLatLng();
      onChangeRef.current(round(p.lat), round(p.lng));
    });
    markerRef.current = m;
  }

  // Build the map once.
  useEffect(() => {
    let disposed = false;
    import("leaflet").then((mod) => {
      if (disposed || !containerRef.current) return;
      const L = mod.default ?? mod;
      LRef.current = L;

      const { lat: la, lng: ln } = initialRef.current;
      const hasPin = la != null && ln != null;
      const map = L.map(containerRef.current, {
        center: hasPin ? [la as number, ln as number] : BAKU_CENTER,
        zoom: hasPin ? 15 : 12,
        scrollWheelZoom: true,
      });
      mapRef.current = map;
      map.attributionControl.setPrefix("");
      osmTileLayer(L).addTo(map);

      if (hasPin) placePin(L, map, la as number, ln as number);

      // Click anywhere to drop / move the pin.
      map.on("click", (e) => {
        placePin(L, map, e.latlng.lat, e.latlng.lng);
        onChangeRef.current(round(e.latlng.lat), round(e.latlng.lng));
      });

      setTimeout(() => map.invalidateSize(), 0);
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = undefined;
      markerRef.current = undefined;
    };
    // Mount-only: initial view is captured in refs; prop changes are handled
    // by the sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror controlled props onto the marker (handles a parent "clear", and any
  // external coordinate change) without feeding back into onChange.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    if (lat == null || lng == null) {
      markerRef.current?.remove();
      markerRef.current = undefined;
      return;
    }
    const cur = markerRef.current?.getLatLng();
    if (!cur || Math.abs(cur.lat - lat) > 1e-7 || Math.abs(cur.lng - lng) > 1e-7) {
      placePin(L, map, lat, lng);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  function useMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeo("unsupported");
      return;
    }
    setGeo("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const la = round(pos.coords.latitude);
        const ln = round(pos.coords.longitude);
        const L = LRef.current;
        const map = mapRef.current;
        if (L && map) {
          placePin(L, map, la, ln);
          map.setView([la, ln], 16);
        }
        onChangeRef.current(la, ln);
        setGeo("idle");
      },
      (err) => {
        setGeo(err.code === err.PERMISSION_DENIED ? "denied" : "error");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }

  const geoMsg =
    geo === "denied"
      ? t("geoDenied")
      : geo === "unsupported"
        ? t("geoUnsupported")
        : geo === "error"
          ? t("geoError")
          : null;

  return (
    <div>
      <div className="relative overflow-hidden rounded-lg border border-border">
        <div ref={containerRef} className="h-[360px] w-full" role="application" aria-label={t("mapAria")} />
        <button
          type="button"
          onClick={useMyLocation}
          disabled={geo === "locating"}
          className="absolute right-3 top-3 z-[500] inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/95 px-3 py-2 text-xs font-medium text-foreground shadow-soft backdrop-blur transition hover:bg-hover disabled:opacity-60"
        >
          {geo === "locating" ? (
            <Crosshair className="h-4 w-4 animate-pulse text-accent" strokeWidth={2} />
          ) : (
            <LocateFixed className="h-4 w-4 text-accent" strokeWidth={2} />
          )}
          {geo === "locating" ? t("locating") : t("useMyLocation")}
        </button>
      </div>
      <p className="mt-2 text-xs text-faint-foreground">{t("hint")}</p>
      {geoMsg && <p className="mt-1 text-xs text-rose-700 dark:text-rose-400">{geoMsg}</p>}
    </div>
  );
}
