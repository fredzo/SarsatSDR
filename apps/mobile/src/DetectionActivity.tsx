import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

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

export function DetectionActivity({ generation, detections }: { generation: "FGB" | "SGB"; detections: number }) {
  const label = `${generation}: ${detections} new detections since the last update`;
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={label}
    aria-valuemin={0} aria-valuemax={10} aria-valuenow={Math.min(detections, 10)} style={styles.widget}>
    <Text style={styles.text}>{generation}</Text>
    <View style={styles.meter}>
      {colors.map((color, index) => <Segment key={index} color={color} active={detections > index} />)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  widget: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 },
  meter: { flexDirection: "row", gap: 1 },
  segment: { width: 10, height: 7, borderRadius: 1, borderWidth: 1 },
  text: { fontFamily: "monospace", fontSize: 10, color: "#00ffff" },
});
