"use client";

import { useEffect } from "react";
import { installGameAudioUnlock } from "@/game/audio/gameAudio";

export function GameAudioUnlock() {
  useEffect(() => installGameAudioUnlock(), []);
  return null;
}
