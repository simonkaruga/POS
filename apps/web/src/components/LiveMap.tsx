import { useMemo } from 'react';

/**
 * A small slippy map built directly on OpenStreetMap raster tiles.
 *
 * The rest of the app embeds OSM through its `export/embed.html` iframe, but that
 * only supports a single marker — no good for a dispatch view with several drivers.
 * Rather than pull in Leaflet (and a stylesheet, and an API-key-shaped dependency),
 * this lays the tiles out itself: Web Mercator is a dozen lines of maths, and doing
 * the projection here means markers land on exact pixels instead of being nudged by
 * an iframe re-fitting its bounding box.
 *
 * No API key and no tracking script. OSM's tile policy is fine with this volume;
 * a busy fleet should point TILE_URL at a paid tile host.
 */

const TILE_SIZE = 256;
const TILE_URL = (z: number, x: number, y: number) =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  sublabel?: string;
  /** Marker tint. Muted styling is the caller's cue for a stale position. */
  color?: string;
  muted?: boolean;
}

// ── Web Mercator ────────────────────────────────────────────────────────────

function lngToWorldX(lng: number, z: number) {
  return ((lng + 180) / 360) * TILE_SIZE * 2 ** z;
}

function latToWorldY(lat: number, z: number) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * TILE_SIZE * 2 ** z;
}

/** Largest zoom at which every point still fits inside width×height, with padding. */
function fitZoom(points: MapPoint[], width: number, height: number): number {
  if (points.length <= 1) return 15;
  const pad = 64;
  for (let z = 18; z >= 2; z--) {
    const xs = points.map(p => lngToWorldX(p.lng, z));
    const ys = points.map(p => latToWorldY(p.lat, z));
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    if (spanX <= width - pad && spanY <= height - pad) return z;
  }
  return 2;
}

export default function LiveMap({
  points,
  height = 320,
  width = 900,
  emptyMessage = 'No positions to show yet.',
}: {
  points: MapPoint[];
  height?: number;
  width?: number;
  emptyMessage?: string;
}) {
  const view = useMemo(() => {
    if (points.length === 0) return null;

    const zoom = fitZoom(points, width, height);
    // Centre on the midpoint of the points' bounding box, in world pixels.
    const xs = points.map(p => lngToWorldX(p.lng, zoom));
    const ys = points.map(p => latToWorldY(p.lat, zoom));
    const centreX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centreY = (Math.min(...ys) + Math.max(...ys)) / 2;

    // Top-left of the viewport in world pixels, then the tiles covering it.
    const originX = centreX - width / 2;
    const originY = centreY - height / 2;
    const maxTile = 2 ** zoom;

    const tiles: Array<{ key: string; src: string; left: number; top: number }> = [];
    const firstTileX = Math.floor(originX / TILE_SIZE);
    const firstTileY = Math.floor(originY / TILE_SIZE);
    const lastTileX = Math.floor((originX + width) / TILE_SIZE);
    const lastTileY = Math.floor((originY + height) / TILE_SIZE);

    for (let tx = firstTileX; tx <= lastTileX; tx++) {
      for (let ty = firstTileY; ty <= lastTileY; ty++) {
        if (ty < 0 || ty >= maxTile) continue; // no tiles above the pole
        const wrappedX = ((tx % maxTile) + maxTile) % maxTile; // wrap around the date line
        tiles.push({
          key: `${zoom}/${tx}/${ty}`,
          src: TILE_URL(zoom, wrappedX, ty),
          left: tx * TILE_SIZE - originX,
          top: ty * TILE_SIZE - originY,
        });
      }
    }

    const placed = points.map((p, i) => ({
      ...p,
      x: lngToWorldX(p.lng, zoom) - originX,
      y: latToWorldY(p.lat, zoom) - originY,
      index: i,
    }));

    return { tiles, placed, zoom };
  }, [points, width, height]);

  if (!view) {
    return (
      <div
        className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center justify-center text-sm text-gray-400"
        style={{ height }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      className="relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-200"
      style={{ height }}
    >
      {view.tiles.map(t => (
        <img
          key={t.key}
          src={t.src}
          alt=""
          aria-hidden
          loading="lazy"
          draggable={false}
          className="absolute select-none"
          style={{ left: t.left, top: t.top, width: TILE_SIZE, height: TILE_SIZE }}
        />
      ))}

      {view.placed.map(p => (
        <div
          key={p.id}
          className="absolute -translate-x-1/2 -translate-y-full flex flex-col items-center"
          style={{ left: p.x, top: p.y }}
        >
          <div
            className={`px-2 py-0.5 rounded-md text-[11px] font-semibold text-white whitespace-nowrap shadow ${
              p.muted ? 'opacity-60' : ''
            }`}
            style={{ backgroundColor: p.color ?? '#1F6BFF' }}
          >
            {p.label}
            {p.sublabel && <span className="font-normal opacity-90"> · {p.sublabel}</span>}
          </div>
          <div
            className={`w-3 h-3 rotate-45 -mt-1 shadow ${p.muted ? 'opacity-60' : ''}`}
            style={{ backgroundColor: p.color ?? '#1F6BFF' }}
          />
        </div>
      ))}

      {/* OSM requires attribution on any map built from their tiles. */}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="absolute bottom-0 right-0 bg-white/80 text-[10px] text-gray-600 px-1.5 py-0.5 rounded-tl hover:underline"
      >
        © OpenStreetMap
      </a>
    </div>
  );
}
