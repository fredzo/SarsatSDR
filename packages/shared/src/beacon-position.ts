import type { Frame } from "./protocol";

export function beaconPosition(frame: Frame) {
  const value = (name: string) => {
    const text = frame.fields?.find(field => field.name === name)?.value;
    return text?.trim() ? Number(text) : NaN;
  };
  const lat = value("Latitude"), lon = value("Longitude");
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

export function beaconLocator(frame: Frame) {
  const position = beaconPosition(frame);
  if (!position) return null;
  const x = Math.min(Math.floor((position.lon + 180) * 2880), 360 * 2880 - 1);
  const y = Math.min(Math.floor((position.lat + 90) * 5760), 180 * 5760 - 1);
  const pair = (divisor: number, base: number, size: number) =>
    String.fromCharCode(base + Math.floor(x / divisor) % size, base + Math.floor(y / divisor) % size);
  return pair(57600, 65, 18) + pair(5760, 48, 10) + pair(240, 97, 24) +
    pair(24, 48, 10) + pair(1, 97, 24);
}

export const googleMapsUrl = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
export const wazeUrl = (lat: number, lon: number) => `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`;
