import { createElement, type ComponentType } from "react";
import { Platform, Text } from "react-native";
import { WebView } from "react-native-webview";

export function OfficialDecoder({ url, onError }: { url: string; onError: (message: string) => void }) {
  if (Platform.OS === "web") {
    return createElement("iframe", {
      title: "COSPAS-SARSAT Beacon Decoder", src: url, referrerPolicy: "no-referrer",
      style: { display: "block", flex: 1, width: "100%", border: 0 },
      onError: () => onError("Could not load the official decoder. Try opening it in your browser."),
    });
  }
  const DecoderWebView: ComponentType<{
    source: { uri: string }; style: { flex: number }; renderError: () => React.ReactElement;
    onHttpError: (event: { nativeEvent: { statusCode: number } }) => void;
  }> = WebView;
  return <DecoderWebView source={{ uri: url }} style={{ flex: 1 }}
    renderError={() => <Text style={{ color: "#ff8484" }}>Could not load the official decoder.</Text>}
    onHttpError={({ nativeEvent }) => onError(`Official decoder: HTTP ${nativeEvent.statusCode}`)} />;
}
