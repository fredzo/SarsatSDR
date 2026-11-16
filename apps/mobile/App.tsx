import { useKeepAwake } from "expo-keep-awake";
import { StatusBar } from "expo-status-bar";
import { Platform, StatusBar as NativeStatusBar, View } from "react-native";
import SarsatApp from "./src/App";

export default function App() {
  useKeepAwake();
  return <View style={{ flex: 1, backgroundColor: "#002222", paddingTop: Platform.OS === "android" ? NativeStatusBar.currentHeight ?? 0 : 0 }}>
    <StatusBar style="light" /><SarsatApp /></View>;
}
