import { useCallback, useRef, useSyncExternalStore } from "react";
import { signal, computed, effect, batch, type Signal } from "@preact/signals-core";

export { signal, computed, effect, batch };
export type { Signal };

/**
 * Subscribe the calling component to a signal. Re-renders only when this
 * specific signal's value changes — not on every parent render. Built on
 * React 19's useSyncExternalStore so no Babel transform is required.
 */
export function useSignalValue<T>(sig: Signal<T>): T {
  const subscribe = useCallback(
    (onChange: () => void) => sig.subscribe(onChange),
    [sig],
  );
  return useSyncExternalStore(subscribe, () => sig.value, () => sig.value);
}

/**
 * Lazy-init a value that lives for the lifetime of the component. Useful for
 * creating signals or context values that should never be reconstructed.
 */
export function useConstant<T>(init: () => T): T {
  const ref = useRef<{ value: T } | null>(null);
  if (ref.current === null) ref.current = { value: init() };
  return ref.current.value;
}

interface PersistedOptions<T> {
  serialize?: (value: T) => string;
  deserialize?: (raw: string) => T;
}

/**
 * Signal whose value is mirrored to localStorage under `key`. Reads the
 * stored value on creation; writes on every change. Falls back to `initial`
 * if storage is unavailable or the stored value fails to parse.
 */
export function persistedSignal<T>(
  key: string,
  initial: T,
  options: PersistedOptions<T> = {},
): Signal<T> {
  const serialize = options.serialize ?? JSON.stringify;
  const deserialize = options.deserialize ?? (JSON.parse as (raw: string) => T);

  let start = initial;
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) start = deserialize(raw);
  } catch { /* storage unavailable or parse failed — use initial */ }

  const sig = signal<T>(start);
  effect(() => {
    try { localStorage.setItem(key, serialize(sig.value)); } catch {}
  });
  return sig;
}
