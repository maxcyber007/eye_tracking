"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";

interface AsyncState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** Re-run the loader, e.g. after a mutation. */
  reload: () => Promise<void>;
}

/**
 * Run an async loader on mount and expose its state.
 *
 * Keeps every data panel from re-implementing the same loading/error/reload
 * triple, and guards against setting state after unmount.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  dependencies: unknown[] = [],
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  // The loader identity is intentionally controlled by `dependencies`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(loader, dependencies);

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await run());
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError(0, { message: String(caught) }),
      );
    } finally {
      setLoading(false);
    }
  }, [run]);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await run();
        if (active) setData(result);
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof ApiError
              ? caught
              : new ApiError(0, { message: String(caught) }),
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [run]);

  return { data, error, loading, reload: execute };
}
