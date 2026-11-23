import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { z } from "zod";
import { receptionPreferencesSchema } from "./reception-preferences";

const storageKey = "sarsat.reception-preferences";

export function useReceptionPreferences(onError: (message: string) => void) {
  return useStoredPreferences(storageKey, receptionPreferencesSchema, onError);
}

export function useStoredPreferences<T extends object>(key: string, schema: z.ZodType<T>, onError: (message: string) => void) {
  const [preferences, setPreferences] = useState(() => schema.parse({}));
  const [ready, setReady] = useState(false);
  const current = useRef(preferences);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(key).then(value => {
      if (!active) return;
      const restored = schema.parse(value === null ? {} : JSON.parse(value));
      current.current = restored;
      setPreferences(restored);
      const normalized = JSON.stringify(restored);
      if (value !== null && normalized !== value)
        writes.current = writes.current.then(() => AsyncStorage.setItem(key, normalized))
          .catch(reason => onError(`Could not save ${key}: ${String(reason)}`));
    }).catch(reason => {
      if (active) onError(`Could not load ${key}: ${String(reason)}`);
    }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [key, schema, onError]);

  const replace = useCallback((values: Partial<T>) => {
    if (!ready) return;
    const next = schema.safeParse({ ...current.current, ...values });
    if (!next.success) {
      onError(next.error.issues.map(issue => issue.message).join(" · "));
      return;
    }
    current.current = next.data;
    setPreferences(next.data);
    writes.current = writes.current.then(() => AsyncStorage.setItem(key, JSON.stringify(next.data)))
      .catch(reason => onError(`Could not save ${key}: ${String(reason)}`));
  }, [ready, key, schema, onError]);
  const change = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    replace({ ...current.current, [field]: value });
  }, [replace]);
  return { preferences, current, ready, change, replace };
}
