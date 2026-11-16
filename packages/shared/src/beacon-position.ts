import type { Frame } from "./protocol";

export function beaconPosition(frame: Frame) {
  const value = (name: string) => Number(frame.fields?.find(field => field.name === name)?.value);
  const lat = value("Latitude"), lon = value("Longitude");
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

export const googleMapsUrl = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
export const wazeUrl = (lat: number, lon: number) => `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`;
