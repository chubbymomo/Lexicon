"use client";

import { useCallback, useEffect, useState } from "react";

type State<T> = { data: T | null; error: Error | null; loading: boolean };

/** Load data on mount (and when `key` changes); `reload` refetches, `set` updates in place. */
export function useResource<T>(loader: () => Promise<T>, key: string = "") {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loader().then(
      (data) => !cancelled && setState({ data, error: null, loading: false }),
      (error) => !cancelled && setState((s) => ({ ...s, error, loading: false })),
    );
    return () => {
      cancelled = true;
    };
    // The loader is identified by `key`; callers pass a fresh closure each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const set = useCallback(
    (data: T) => setState({ data, error: null, loading: false }),
    [],
  );
  return { ...state, reload, set };
}
