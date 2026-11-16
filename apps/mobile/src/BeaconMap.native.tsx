import { useEffect, useRef, type ComponentType, type Ref } from "react";
import { WebView as RawWebView } from "react-native-webview";

type WebViewHandle = { injectJavaScript(script: string): void };
// WebViewProps intersection collapses to never with current React types.
const WebView = RawWebView as unknown as ComponentType<{ ref?: Ref<WebViewHandle>; originWhitelist: string[]; source: { html: string; baseUrl: string }; style: object }>;

const html = (lat: number, lon: number) => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
  integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<style>html,body,#map{margin:0;height:100%;background:#0d141d}</style></head><body><div id="map"></div><script>
const map = L.map("map", { center: [${lat}, ${lon}], zoom: 14 });
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
const marker = L.circleMarker([${lat}, ${lon}], { radius: 10, color: "#fff", weight: 3, fillColor: "#d4332a", fillOpacity: 1 }).addTo(map);
window.moveBeacon = (lat, lon) => { marker.setLatLng([lat, lon]); map.setView([lat, lon], map.getZoom()); };
</script></body></html>`;

export function BeaconMap({ lat, lon }: { lat: number; lon: number }) {
  const view = useRef<WebViewHandle>(null);
  const initial = useRef(html(lat, lon));
  useEffect(() => { view.current?.injectJavaScript(`window.moveBeacon && window.moveBeacon(${lat}, ${lon}); true;`); }, [lat, lon]);
  return <WebView ref={view} originWhitelist={["*"]} source={{ html: initial.current, baseUrl: "https://sarsat.local/" }}
    style={{ flex: 1, minHeight: 360, backgroundColor: "#0d141d" }} />;
}
