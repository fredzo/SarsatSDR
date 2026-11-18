import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export function BeaconMap({ lat, lon }: { lat: number; lon: number }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    const instance = L.map(container.current!, { center: [lat, lon], zoom: 14 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>",
    }).addTo(instance);
    marker.current = L.circleMarker([lat, lon], { radius: 10, color: "#fff", weight: 3, fillColor: "#d4332a", fillOpacity: 1 }).addTo(instance);
    map.current = instance;
    const observer = new ResizeObserver(() => instance.invalidateSize({ pan: false }));
    observer.observe(container.current!);
    return () => { observer.disconnect(); instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    marker.current?.setLatLng([lat, lon]);
    map.current?.setView([lat, lon], map.current.getZoom());
  }, [lat, lon]);

  return <div ref={container} style={{ flex: 1, minHeight: 0, border: "1px solid #28364a" }} role="region" aria-label="Beacon position on OpenStreetMap" />;
}
