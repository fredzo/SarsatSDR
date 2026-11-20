import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { receptionPreferencesSchema, type ReceptionPreferences } from "./reception-preferences";

const storageKey = "sarsat.reception-preferences";

export function useReceptionPreferences(onError: (message: string) => void) {
  const [preferences, setPreferences] = useState(() => receptionPreferencesSchema.parse({}));
  const [ready, setReady] = useState(false);
  const current = useRef(preferences);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(storageKey).then(value => {
      if (!active) return;
      const restored = receptionPreferencesSchema.parse(value === null ? {} : JSON.parse(value));
      current.current = restored;
      setPreferences(restored);
    }).catch(reason => {
      if (active) onError(`Could not load reception preferences: ${String(reason)}`);
    }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [onError]);

  const change = useCallback(<K extends keyof ReceptionPreferences>(key: K, value: ReceptionPreferences[K]) => {
    if (!ready) return;
    const next = receptionPreferencesSchema.safeParse({ ...current.current, [key]: value });
    if (!next.success) {
      onError(next.error.issues.map(issue => issue.message).join(" · "));
      return;
    }
    current.current = next.data;
    setPreferences(next.data);
    writes.current = writes.current.then(() => AsyncStorage.setItem(storageKey, JSON.stringify(next.data)))
      .catch(reason => onError(`Could not save reception preferences: ${String(reason)}`));
  }, [ready, onError]);
  return { preferences, current, ready, change };
}
