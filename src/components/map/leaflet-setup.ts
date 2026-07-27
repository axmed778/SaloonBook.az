// Shared Leaflet building blocks for the discovery map and the location picker.
//
// This module imports ONLY types from leaflet (erased at compile time), so it is
// safe to import from any client component without pulling Leaflet's `window`-
// touching runtime into the server render. The actual `L` namespace is loaded
// lazily (`await import("leaflet")`) inside each component's effect and passed
// into these helpers.

type Leaflet = typeof import("leaflet");

// OpenStreetMap raster tiles — the open, keyless basemap (no Google, no billing).
// The tile host is allow-listed in the CSP img-src (see next.config.ts).
export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">OpenStreetMap</a>';

// Fallback view (Baku) when there are no pins to fit the map to.
export const BAKU_CENTER: [number, number] = [40.4093, 49.8671];
export const BAKU_ZOOM = 11;

/** OSM tile layer, ready to `.addTo(map)`. */
export function osmTileLayer(L: Leaflet) {
  return L.tileLayer(OSM_TILE_URL, { attribution: OSM_ATTRIBUTION, maxZoom: 19 });
}

/**
 * Brand map-pin as a Leaflet DivIcon. Passing our own `className` drops
 * Leaflet's default white-box `leaflet-div-icon` styling; the accent colour and
 * drop shadow come from the `.salon-pin` rule in globals.css (so it tracks the
 * active theme). The tip of the teardrop is the anchor.
 */
export function pinIcon(L: Leaflet) {
  return L.divIcon({
    className: "salon-pin",
    html: `<svg viewBox="0 0 24 24" width="30" height="30" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M12 22s7-6.1 7-12A7 7 0 0 0 5 10c0 5.9 7 12 7 12Z" fill="currentColor" stroke="#fff" stroke-width="1.4"/>
  <circle cx="12" cy="10" r="2.7" fill="#fff"/>
</svg>`,
    iconSize: [30, 30],
    iconAnchor: [15, 29],
    popupAnchor: [0, -28],
  });
}
