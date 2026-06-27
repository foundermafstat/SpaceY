import { frameDefs } from "@/game/data/frames";
import { frameToCabinDef } from "@/game/ship/domainCompat";
import type { CabinDef } from "@/game/types";

const scoutFrame = frameDefs.find((frame) => frame.id === "scout_frame");
if (!scoutFrame) throw new Error("Missing scout_frame");

const enemyCabins = frameDefs
  .filter((frame) => frame.id !== "scout_frame")
  .map(frameToCabinDef);

export const cabinDefs: CabinDef[] = [
  {
    ...frameToCabinDef(scoutFrame),
    id: "solo_pod_mk1",
    name: "Solo Pod Mk I",
    baseEnergy: 10,
    crew: 1,
    role: "scout",
    legacyFrameId: "scout_frame"
  },
  ...enemyCabins
];

export function getCabinIdForFrame(frameId: string) {
  return cabinDefs.find((cabin) => cabin.legacyFrameId === frameId)?.id ?? "solo_pod_mk1";
}
