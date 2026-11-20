import { beaconLocator, beaconPosition } from "@sarsat/shared/beacon-position";
import type { Frame } from "@sarsat/shared/protocol";

export function formatFieldFrequencies(value: string) {
  return value.replace(/\b(\d+(?:\.\d+)?)\s*(GHz|MHz|kHz|Hz)\b/g,
    (_, frequency: string, unit: string) => `${Number(frequency).toFixed(3)} ${unit}`);
}

function dms(value: number, positive: string, negative: string) {
  const tenths = Math.round(Math.abs(value) * 36000);
  const degrees = Math.floor(tenths / 36000);
  const minutes = Math.floor(tenths % 36000 / 600);
  const seconds = (tenths % 600 / 10).toFixed(1).padStart(4, "0");
  return `${degrees}°${String(minutes).padStart(2, "0")}'${seconds}"${value < 0 || Object.is(value, -0) ? negative : positive}`;
}

export function frameSummary(frame: Frame) {
  const field = (name: string, section?: string) =>
    frame.fields?.find(item => item.name === name && (!section || item.section === section))?.value;
  const position = beaconPosition(frame);
  const info = frame.generation === 1
    ? [field("Protocol"), field("Protocol Description"), field("Additional Data")]
    : [field("Type", "Identification"), field("Vessel ID", "Identification")];
  const emergency = frame.generation === 1
    ? [field("Emergency", "Emergency"), field("Emergency Mode", "Emergency")]
    : [field("Triggering Event", "Rotating Field 1")];
  const displayed: Record<string, string[]> = {
    Identification: ["Frame Mode", "Protocol", "Protocol Description", "Additional Data", "Country",
      "Hex ID", "23 Hex ID", "Serial Number", ...(frame.generation === 2 ? ["Type", "Vessel ID"] : [])],
    Location: ["Latitude", "Longitude", "Position"],
    "Encoded GNSS Location": ["Latitude", "Longitude", "Position"],
    Emergency: ["Emergency", "Emergency Mode"],
    Devices: ["Main Locating Device", "Auxiliary Locating Device"],
    Status: frame.generation === 2 ? ["Homing Device"] : [],
    "Rotating Field 1": frame.generation === 2 ? ["Triggering Event"] : [],
  };
  return {
    info: info.filter((value): value is string => !!value),
    country: field("Country"),
    position: position && {
      locator: beaconLocator(frame),
      dms: `${dms(position.lat, "N", "S")}, ${dms(position.lon, "E", "W")}`,
      decimal: `${position.lat.toFixed(6)}, ${position.lon.toFixed(6)}`,
    },
    positionStatus: field("Position"),
    emergency: emergency.filter((value): value is string => !!value),
    hexId: field(frame.generation === 1 ? "Hex ID" : "23 Hex ID"),
    serial: field("Serial Number"),
    mainDevice: field("Main Locating Device"),
    auxDevice: field("Auxiliary Locating Device"),
    homingDevice: frame.generation === 2 ? field("Homing Device", "Status") : undefined,
    extraFields: frame.fields?.filter(item => !displayed[item.section]?.includes(item.name)) ?? [],
  };
}

export function fitExtraFields(heights: (number | undefined)[], available: [number, number], gap: number) {
  const remaining = [...available];
  const columns: [number[], number[]] = [[], []];
  heights.forEach((height, index) => {
    if (height === undefined) return;
    const column = remaining[0] >= remaining[1] ? 0 : 1;
    if (height + gap <= remaining[column]) {
      columns[column].push(index);
      remaining[column] -= height + gap;
    }
  });
  return columns;
}
