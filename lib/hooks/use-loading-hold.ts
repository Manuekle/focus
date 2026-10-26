"use client";

import { useEffect, useState } from "react";

export const LOADING_HOLD_MS = 1_500;

/** Prevent a fast response from flashing the loading screen. The hold runs
 * alongside the request: a slower response never gets an extra delay. */
export function useLoadingHold(isLoading: boolean) {
  const [state, setState] = useState({ loading: isLoading, holding: isLoading, cycle: isLoading ? 1 : 0 });

  if (state.loading !== isLoading) {
    setState({
      loading: isLoading,
      holding: isLoading || state.holding,
      cycle: state.cycle + (isLoading ? 1 : 0),
    });
  }

  useEffect(() => {
    if (state.cycle === 0) return;
    const timer = setTimeout(() => {
      setState((previous) => previous.holding ? { ...previous, holding: false } : previous);
    }, LOADING_HOLD_MS);
    return () => clearTimeout(timer);
  }, [state.cycle]);

  return isLoading || state.holding;
}
