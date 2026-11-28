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
