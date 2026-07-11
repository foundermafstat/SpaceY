"use client";

import { useEffect, useState } from "react";
import { useShipStore } from "@/game/store/shipStore";

export function useShipStoreHydrated() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const unsubscribe = useShipStore.persist.onFinishHydration(() => setHydrated(true));
    if (useShipStore.persist.hasHydrated()) {
      setHydrated(true);
    } else {
      void useShipStore.persist.rehydrate();
    }
    return unsubscribe;
  }, []);

  return hydrated;
}
