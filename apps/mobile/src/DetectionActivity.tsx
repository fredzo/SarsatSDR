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

import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { detectionSegments } from "@sarsat/shared/spectrum-display";

const colors = ["#50ef3c", "#50ef3c", "#50ef3c", "#50ef3c", "#50ef3c", "#50ef3c",
  "#ffb83f", "#ffb83f", "#ff4949", "#ff4949"];

function Segment({ color, active }: { color: string; active: boolean }) {
  const [held, setHeld] = useState(active);
  useEffect(() => {
    if (active) { setHeld(true); return; }
    const timeout = setTimeout(() => setHeld(false), 450);
    return () => clearTimeout(timeout);
  }, [active]);
  return <View style={[styles.segment, {
    backgroundColor: color, borderColor: color, opacity: active || held ? 1 : .15,
  }]} />;
}

export function DetectionActivity({ generation, detections, maximum = 10 }: { generation: "FGB" | "SGB"; detections: number; maximum?: number }) {
  const label = `${generation}: ${detections} new detections since the last update`;
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={label}
    aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={Math.min(detections, maximum)} style={styles.widget}>
    <Text style={styles.text}>{generation}</Text>
    <View style={styles.meter}>
      {colors.map((color, index) => <Segment key={index} color={color} active={index < detectionSegments(detections, maximum)} />)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  widget: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 },
  meter: { flexDirection: "row", gap: 1 },
  segment: { width: 10, height: 7, borderRadius: 1, borderWidth: 1 },
  text: { fontFamily: "monospace", fontSize: 10, color: "#00ffff" },
});
