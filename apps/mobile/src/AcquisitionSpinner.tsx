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

import { memo, useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { FgbCountdown } from "./fgb-countdown";
import type { NotificationSound, ReceptionPreferences } from "./reception-preferences";

export type CountdownStart = { id: number; at: number };

export const AcquisitionSpinner = memo(function AcquisitionSpinner({ running, start, preferences, play }: {
  running: boolean;
  start: CountdownStart | null;
  preferences: ReceptionPreferences;
  play: (sound: NotificationSound, volume: number) => void;
}) {
  const rotation = useRef(new Animated.Value(0)).current;
  const clock = useRef(new FgbCountdown());
  const previousStart = useRef<CountdownStart | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const latest = useRef({ preferences, play });
  latest.current = { preferences, play };

  useEffect(() => {
    if (!running) return;
    const animation = Animated.loop(Animated.timing(rotation, {
      toValue: 1, duration: 1500, easing: Easing.linear, useNativeDriver: Platform.OS !== "web",
    }));
    animation.start();
    return () => { animation.stop(); rotation.setValue(0); };
  }, [running, rotation]);

  useEffect(() => {
    if (!running || !preferences.countdown) {
      clock.current.stop();
      setRemaining(null);
      setElapsed(null);
    } else if (!start) {
      clock.current.countUp(Date.now());
    } else if (start !== previousStart.current) {
      clock.current.start(start.at, latest.current.preferences.countdownSeconds);
    }
    previousStart.current = start;
  }, [running, preferences.countdown, start]);

  useEffect(() => {
    if (!running || !preferences.countdown) return;
    const tick = () => {
      const { preferences: options, play: sound } = latest.current;
      const result = clock.current.tick(Date.now(), options.countdownSeconds, options.autoReloadCountdown);
      setRemaining(result.remaining);
      setElapsed(result.elapsed);
      if (result.beep && options.countdownBeep) sound(result.beep, options.volume);
    };
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [running, preferences.countdown, start]);

  if (!running) return <View style={styles.container} />;
  const reset = () => {
    clock.current.countUp(Date.now());
    setRemaining(null);
    setElapsed(0);
    play("filtered", preferences.volume);
  };
  const label = remaining !== null ? `Next FGB frame in ${remaining} seconds`
    : elapsed !== null ? `FGB elapsed counter: ${elapsed} seconds` : "Acquisition in progress";
  const circumference = 2 * Math.PI * 18;
  return <Pressable style={styles.container} accessible
    accessibilityRole={preferences.countdown ? "button" : "progressbar"} accessibilityLabel={label}
    accessibilityHint={preferences.countdown ? "Long press to reset the counter to zero" : undefined}
    onLongPress={preferences.countdown ? reset : undefined}
    accessibilityActions={preferences.countdown ? [{ name: "activate", label: "Reset counter" }] : undefined}
    onAccessibilityAction={event => {
      if (preferences.countdown && event.nativeEvent.actionName === "activate") reset();
    }}>
    <Svg width={40} height={40}>
      <Circle cx={20} cy={20} r={18} fill="none" stroke="#335555" strokeWidth={3} />
    </Svg>
    <Animated.View style={[styles.arc, { transform: [{
      rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }),
    }] }]}>
      <Svg width={40} height={40}>
        <Circle cx={20} cy={20} r={18} fill="none" stroke="#00ffff" strokeWidth={3}
          strokeLinecap="round" strokeDasharray={`${circumference / 4} ${circumference}`} />
      </Svg>
    </Animated.View>
    {(remaining !== null || elapsed !== null) && <Text style={styles.text}>{remaining ?? elapsed}</Text>}
  </Pressable>;
});

const styles = StyleSheet.create({
  container: { width: 40, height: 40, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  arc: { position: "absolute" },
  text: { position: "absolute", fontSize: 13, fontWeight: "600", color: "#ffffff", fontFamily: "monospace" },
});
