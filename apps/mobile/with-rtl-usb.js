/*
 * SarsatSDR
 * Copyright (C) 2026 Frederic BORRY - F4JRX
 * Authors: Frederic BORRY - F4JRX and Copilot (AI-assisted development).
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const action = "android.hardware.usb.action.USB_DEVICE_ATTACHED";
const resource = "rtl_usb_devices";

module.exports = function withRtlUsb(config) {
  config = withAndroidManifest(config, config => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    activity["intent-filter"] ??= [];
    if (!activity["intent-filter"].some(filter => filter.action?.some(item => item.$["android:name"] === action))) {
      activity["intent-filter"].push({
        action: [{ $: { "android:name": action } }],
        category: [{ $: { "android:name": "android.intent.category.DEFAULT" } }],
      });
    }
    activity["meta-data"] ??= [];
    const metadata = activity["meta-data"].find(item => item.$["android:name"] === action);
    if (metadata) metadata.$["android:resource"] = `@xml/${resource}`;
    else activity["meta-data"].push({ $: { "android:name": action, "android:resource": `@xml/${resource}` } });
    return config;
  });

  return withDangerousMod(config, ["android", async config => {
    const { projectRoot, platformProjectRoot } = config.modRequest;
    const tables = await fs.readFile(path.join(projectRoot, "..", "..", "native", "cospas-core", "dsp_tables.hpp"), "utf8");
    const table = tables.match(/,\s*(\d+)>\s+rtl_usb_ids\s*=\s*\{\{([\s\S]*?)\}\};/);
    const ids = table && [...table[2].matchAll(/\{\s*(0x[\da-f]+)\s*,\s*(0x[\da-f]+)\s*\}/gi)];
    if (!ids?.length || ids.length !== Number(table[1])) {
      throw new Error("Could not read all RTL-SDR USB IDs from dsp_tables.hpp");
    }
    const entries = ids.map(([, vendor, product]) =>
      `  <usb-device vendor-id="${Number(vendor)}" product-id="${Number(product)}"/>`);
    const xmlDir = path.join(platformProjectRoot, "app", "src", "main", "res", "xml");
    await fs.mkdir(xmlDir, { recursive: true });
    await fs.writeFile(path.join(xmlDir, `${resource}.xml`),
      `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${entries.join("\n")}\n</resources>\n`);
    return config;
  }]);
};
