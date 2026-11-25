import { test } from "node:test";
import assert from "node:assert/strict";
import type { Frame } from "@sarsat/shared/protocol";
import { beaconLocator, geoUrl } from "@sarsat/shared/beacon-position";
import { fitExtraFields, formatFieldFrequencies, frameDetailType, frameSummary, frameTableLayout, headerStatus, receivedTime } from "../../mobile/src/frame-summary";

const frame = (generation: 1 | 2, fields: NonNullable<Frame["fields"]>): Frame => ({
  generation, mode: "normal", timeSeconds: 0, frequencyOffsetHz: 0, beaconType: generation === 1 ? "EPIRB" : "ELT",
  rawHex: "A".repeat(36), correctedHex: "A".repeat(36),
  bch: [{ valid: true, correctedErrors: 0 }], fields,
});
const field = (name: string, value: string, section = "Identification") => ({ name, value, section });

test("Geo navigation uses signed decimal coordinates with six fractional digits", () => {
  assert.equal(geoUrl(48.123333, -1.234444), "geo:48.123333,-1.234444");
  assert.equal(geoUrl(-33.5, 0), "geo:-33.500000,0.000000");
});

test("FGB summary uses decoded data and formats the position", () => {
  const summary = frameSummary(frame(1, [
    field("Protocol", "Standard Protocol (2)"), field("Protocol Description", "EPIRB - MMSI / Location"),
    field("Additional Data", "C/S TA #=123"), field("Country", "FRA(227) - France"),
    field("Hex ID", "1C64000000FFBFF"), field("Serial Number", "42"),
    field("Latitude", "43.603333", "Location"), field("Longitude", "1.457778", "Location"),
    field("Emergency", "Fire", "Emergency"), field("Emergency Mode", "manual", "Emergency"),
    field("Main Locating Device", "Internal", "Devices"), field("Auxiliary Locating Device", "121.5 MHz", "Devices"),
  ]));
  assert.deepEqual(summary.info, ["Standard Protocol (2)", "EPIRB - MMSI / Location", "C/S TA #=123"]);
  assert.deepEqual(summary.position, { locator: "JN03ro44wt", dms: `43°36'12.0"N, 1°27'28.0"E`, decimal: "43.603333, 1.457778" });
  assert.deepEqual(summary.emergency, ["Fire", "manual"]);
  assert.equal(summary.hexId, "1C64000000FFBFF");
  assert.equal(summary.serial, "42");
  assert.equal(summary.mainDevice, "Internal");
  assert.equal(summary.auxDevice, "121.5 MHz");
});

test("SGB summary uses identification type, 23 Hex ID and emergency event without inventing devices", () => {
  const summary = frameSummary(frame(2, [
    field("Type", "SYSTM"), field("Vessel ID", "Reserved Type"),
    field("Type", "ELT(DT) In-Flight Emergency", "Rotating Field 1"),
    field("Triggering Event", "Manual activation by the crew", "Rotating Field 1"),
    field("23 Hex ID", "9C77FFFE1A7F00000000000"), field("Homing Device", "Enabled", "Status"),
    field("Latitude", "-33.500000", "Encoded GNSS Location"),
    field("Longitude", "-70.750000", "Encoded GNSS Location"),
  ]));
  assert.deepEqual(summary.info, ["System Beacon", "Reserved Type"]);
  assert.deepEqual(summary.emergency, ["Manual activation by the crew"]);
  assert.equal(summary.hexId, "9C77FFFE1A7F00000000000");
  assert.equal(summary.position?.dms, `33°30'00.0"S, 70°45'00.0"W`);
  assert.equal(summary.homingDevice, "Enabled");
  assert.equal(summary.mainDevice, undefined);
  assert.equal(summary.auxDevice, undefined);
  assert.equal(summary.serial, undefined);
});

test("System Beacon is expanded in details without changing the frame's stored type", () => {
  const system = { ...frame(2, []), beaconType: "SYSTM" };
  assert.deepEqual(frameSummary(system).info, ["System Beacon"]);
  assert.equal(system.beaconType, "SYSTM");
  assert.equal(frameDetailType("ELT"), "ELT");
});

test("Unavailable coordinates stay unavailable and boundary coordinates format correctly", () => {
  const missing = frameSummary(frame(1, [field("Position", "GPS not synchronized", "Location")]));
  assert.equal(missing.position, null);
  assert.equal(missing.positionStatus, "GPS not synchronized");
  assert.deepEqual(missing.emergency, []);
  const edge = frameSummary(frame(2, [field("Latitude", "90.000000"), field("Longitude", "180.000000")]));
  assert.equal(edge.position?.locator, "RR99xx99xx");
  assert.equal(edge.position?.dms, `90°00'00.0"N, 180°00'00.0"E`);
  const rounding = frameSummary(frame(2, [field("Latitude", "-0.000000"), field("Longitude", "1.999999")]));
  assert.equal(rounding.position?.dms, `0°00'00.0"S, 2°00'00.0"E`);
  assert.equal(beaconLocator(frame(1, [field("Latitude", ""), field("Longitude", "0")])), null);
  assert.equal(beaconLocator(frame(1, [field("Latitude", "0"), field("Longitude", "0")])), "JJ00aa00aa");
  assert.equal(beaconLocator(frame(1, [field("Latitude", "1"), field("Longitude", "2")])), "JJ11aa00aa");
  assert.equal(beaconLocator(frame(1, [field("Latitude", "-0.000001"), field("Longitude", "-0.000001")])), "II99xx99xx");
});

test("Additional fields retain section-specific decoded information without repeating the summary", () => {
  const fgb = frameSummary(frame(1, [
    field("Frame Mode", "Self-test"), field("Title", "Self-test 406"), field("Frame", "Long (144 bits)"),
    field("Protocol", "Standard Protocol (2)"), field("Latitude", "43.6", "Location"),
  ]));
  assert.deepEqual(fgb.extraFields.map(item => item.name), ["Title", "Frame"]);
  const sgb = frameSummary(frame(2, [
    field("Type", "ELT"), field("Vessel ID", "MMSI"), field("MMSI", "123456789"),
    field("TAC Number", "42"), field("Homing Device", "Enabled", "Status"),
    field("RLS Capability", "Enabled", "Status"), field("Type", "ELT(DT)", "Rotating Field 1"),
    field("Triggering Event", "Manual activation by the crew", "Rotating Field 1"),
    field("Altitude", "432 m", "Rotating Field 1"),
  ]));
  assert.deepEqual(sgb.extraFields.map(item => [item.section, item.name]), [
    ["Identification", "MMSI"], ["Identification", "TAC Number"], ["Status", "RLS Capability"],
    ["Rotating Field 1", "Type"], ["Rotating Field 1", "Altitude"],
  ]);
});

test("Extra fields fit their measured column heights, skipping unknown or oversized rows", () => {
  assert.deepEqual(fitExtraFields([15, 30, undefined, 60, 15, 15], [40, 55], 3), [[1], [0, 4, 5]]);
  assert.deepEqual(fitExtraFields([16], [18, 18], 3), [[], []]);
});

test("Decoded frequency labels display three decimals without changing other numbers", () => {
  assert.equal(formatFieldFrequencies("121.5 MHz / 9 GHz SART, TAC 123"), "121.500 MHz / 9.000 GHz SART, TAC 123");
  assert.equal(formatFieldFrequencies("No device"), "No device");
});

test("Table header mismatch badges stay compact while preserving the full accessible description", () => {
  for (const errors of [1, 3]) {
    const value = { ...frame(1, []), headerErrors: errors };
    const compact = headerStatus(value, true)!;
    assert.equal(compact.text, `H${errors}`);
    assert.ok(compact.text.length <= 2, "Mode must not reserve space for the full mismatch sentence");
    assert.equal(compact.accessibilityLabel, `HEADER ${errors} bit${errors > 1 ? "s" : ""} mismatch`);
    assert.equal(headerStatus(value)?.text, compact.accessibilityLabel);
  }
  assert.equal(headerStatus({ ...frame(1, []), headerErrors: 0 }, true), null);
  assert.equal(headerStatus({ ...frame(2, []), headerErrors: 3 }, true), null);
});

test("Tablet frame columns fit the pane with header errors and corrected BCH badges without widening Mode", () => {
  const rows = [{
    values: ["00:00:00.000", "SGB", "SYSTM", "H3", "406.051", "JN03rn74"],
    bch: ["BCH1 corr. 3", "BCH2 corr. 2"],
  }];
  for (const [glyphWidth, paneWidth] of [[6.6, 460], [7.2, 460], [8, 510]]) {
    const { widths, padding } = frameTableLayout(rows, glyphWidth, paneWidth);
    assert.ok(widths.reduce((sum, width) => sum + width, 0) <= paneWidth, "No horizontal overflow on the tablet");
    assert.equal(widths[3], widths[1], "Mode stays as narrow as its four-character heading");
    assert.ok(widths[0] >= 11 * glyphWidth + 2 * padding, "Do not truncate reception time");
    assert.ok(widths[6] >= 12 * glyphWidth * 10 / 11 + 12 + 2 * padding, "Keep correction counts fully visible");
  }
  const wide = frameTableLayout(rows, 7.2, 800);
  assert.equal(wide.padding, 9, "Keep existing spacing when there is room");
  const narrow = frameTableLayout(rows, 7.2, 250);
  assert.ok(narrow.widths.reduce((sum, width) => sum + width, 0) > 250, "Keep scrolling on genuinely narrow screens rather than clipping cells");
});

test("Reception timestamps use local European dates and three millisecond digits", () => {
  const local = new Date(2026, 0, 2, 0, 4, 5, 6);
  assert.equal(receivedTime(local.toISOString()), "02/01/2026 00:04:05.006");
  const secondsOnly = new Date(2026, 11, 31, 23, 59, 59);
  assert.equal(receivedTime(secondsOnly.toISOString().replace(".000Z", "Z")), "31/12/2026 23:59:59.000");
  assert.throws(() => receivedTime("invalid"), /Invalid reception timestamp/);
});
