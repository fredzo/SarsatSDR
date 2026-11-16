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

export function SgbActivity({ detections }: { detections: number }) {
  const label = `SGB : ${detections} nouvelles detections depuis le dernier releve`;
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={label}
    aria-valuemin={0} aria-valuemax={10} aria-valuenow={Math.min(detections, 10)} style={styles.widget}>
    <Text style={styles.text}>SGB</Text>
    <View style={styles.meter}>
      {colors.map((color, index) => <Segment key={index} color={color} active={detections > index} />)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  widget: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10 },
  meter: { flexDirection: "row", gap: 2 },
  segment: { width: 12, height: 7, borderRadius: 1, borderWidth: 1 },
  text: { fontFamily: "monospace", fontSize: 10, color: "#00ffff" },
});
