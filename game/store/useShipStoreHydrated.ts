"use client";

import { useEffect, useState } from "react";
import { useShipStore } from "@/game/store/shipStore";

export function useShipStoreHydrated() {
  const [hydrated, setHydrated] = useState(() => useShipStore.persist?.hasHydrated?.() ?? false);

  useEffect(() => {
    const persist = useShipStore.persist;
    if (!persist) {
      setHydrated(true);
      return;
    }
    let active = true;
    const markHydrated = () => {
      if (active) setHydrated(true);
    };
    const unsubscribe = persist.onFinishHydration(markHydrated);
    if (persist.hasHydrated()) {
      markHydrated();
    } else {
      try {
        void Promise.resolve(persist.rehydrate()).then(markHydrated, markHydrated);
      } catch {
        markHydrated();
      }
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return hydrated;
}
