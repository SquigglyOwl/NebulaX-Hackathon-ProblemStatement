"use client";

import L from "leaflet";
import { useEffect, useRef } from "react";
import type { Station, WalkPoint } from "@/lib/types";

interface Props {
  stations: Station[];
  affectedStationCodes: string[];
  commitStationCode?: string | null;
  walk?: { home: WalkPoint; office: WalkPoint };
}

export default function MapView({ stations, affectedStationCodes, commitStationCode, walk }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false });
    // NOT the public OSM tile server (tile.openstreetmap.org) — PS2_README
    // §2.3 forbids app use of it (donated infrastructure, no bulk/app use).
    // Was Stadia Maps, which auto-authenticates localhost but needs the
    // deployed domain allow-listed in the Stadia dashboard to serve tiles
    // there — nobody on the team had that dashboard access when the Vercel
    // demo needed fixing, so it silently 401'd on every non-localhost tile
    // request. Switched to CARTO's basemap tiles instead: free, genuinely
    // keyless (no signup/dashboard/domain allow-list needed at all, unlike
    // Stadia), and CARTO's own terms permit this for exactly this kind of
    // light, non-commercial app use — see carto.com/basemaps. Still an
    // OSM-derived style, so the OpenStreetMap attribution requirement
    // (§2.3, ODbL) still applies and is kept below. `light_all` stays
    // readable in bright sunlight (§3.2.3), same reasoning as the Stadia
    // style it replaced. NEXT_PUBLIC_TILE_URL still overrides this for
    // anyone who does set up a keyed provider later.
    const tileUrl =
      process.env.NEXT_PUBLIC_TILE_URL ||
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
    const tileAttribution =
      process.env.NEXT_PUBLIC_TILE_ATTRIBUTION ||
      '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    L.tileLayer(tileUrl, {
      maxZoom: 20,
      attribution: tileAttribution,
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || stations.length === 0) return;
    layer.clearLayers();

    const affected = new Set(affectedStationCodes);
    const latlngs = stations.map((s) => [s.lat, s.lng] as [number, number]);
    const allBoundsPoints = [...latlngs];

    if (walk) {
      // Real OSM footpath geometry when available (walk.*.routeSource ===
      // "osm"), a straight-line fallback otherwise — either way `route` is
      // already the full point list to draw. Dashed and thinner than the
      // train line so they read as "walking", not "riding".
      L.polyline(walk.home.route, { color: "#5b6472", weight: 3, dashArray: "1 8", opacity: 0.8 }).addTo(
        layer,
      );
      L.polyline(walk.office.route, { color: "#5b6472", weight: 3, dashArray: "1 8", opacity: 0.8 }).addTo(
        layer,
      );

      const walkIcon = (label: string, color: string) =>
        L.divIcon({
          className: "",
          html: `<div style="background:${color};color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)">${label}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });

      L.marker([walk.home.lat, walk.home.lng], { icon: walkIcon("H", "#1a7f37") })
        .addTo(layer)
        .bindTooltip(`${walk.home.name} · ${walk.home.minutes} min walk`, { direction: "top", offset: [0, -8] });
      L.marker([walk.office.lat, walk.office.lng], { icon: walkIcon("W", "#6b21a8") })
        .addTo(layer)
        .bindTooltip(`${walk.office.name} · ${walk.office.minutes} min walk`, { direction: "top", offset: [0, -8] });

      allBoundsPoints.push(...walk.home.route, ...walk.office.route);
    }

    L.polyline(latlngs, { color: "#9aa3af", weight: 5, opacity: 0.9 }).addTo(layer);

    // Highlight the contiguous affected sub-segment, if any, over the base line.
    const affectedIdx = stations.map((s, i) => (affected.has(s.code) ? i : -1)).filter((i) => i >= 0);
    if (affectedIdx.length > 0) {
      const start = Math.min(...affectedIdx);
      const end = Math.max(...affectedIdx);
      const affectedLatLngs = latlngs.slice(start, end + 1);
      L.polyline(affectedLatLngs, { color: "#d0301f", weight: 6, dashArray: "2 10" }).addTo(layer);
    }

    stations.forEach((s) => {
      const isAffected = affected.has(s.code);
      const isCommit = s.code === commitStationCode;
      L.circleMarker([s.lat, s.lng], {
        radius: isCommit ? 9 : isAffected ? 6 : 4,
        color: isCommit ? "#0b5fff" : isAffected ? "#d0301f" : "#5b6472",
        fillColor: isCommit ? "#0b5fff" : isAffected ? "#d0301f" : "#ffffff",
        fillOpacity: isCommit ? 0.35 : 1,
        weight: isCommit ? 3 : 2,
      })
        .addTo(layer)
        .bindTooltip(isCommit ? `${s.name} — switch here` : s.name, {
          direction: "top",
          offset: [0, -4],
          permanent: isCommit,
        });
    });

    map.fitBounds(L.latLngBounds(allBoundsPoints), { padding: [24, 24] });
  }, [stations, affectedStationCodes, commitStationCode, walk]);

  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
}
