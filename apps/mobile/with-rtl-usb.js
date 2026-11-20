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
