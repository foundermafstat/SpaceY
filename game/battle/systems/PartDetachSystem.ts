import { getDetachedGroupsAfterPartDestroyed } from "@/game/ship/topology";
import type { ShipRuntime } from "@/game/ship/runtime";
import type { RuntimePartState } from "@/game/types";
import type { Vec } from "@/game/battle/math";

export type DetachedDebrisEntity = {
  partId: string;
  cells: RuntimePartState["gridCells"];
  velocity: Vec;
  angularVelocity: number;
};

export type PartDetachResult = {
  runtime: ShipRuntime;
  detachedPartIds: string[];
  debris: DetachedDebrisEntity[];
};

export function applyPartDetach(runtime: ShipRuntime, destroyedPartId: string): PartDetachResult {
  const cabinNodeId = runtime.topology.nodes.find((node) => node.kind === "cabin")?.id;
  if (!cabinNodeId) return { runtime, detachedPartIds: [], debris: [] };

  const detachedNodeIds = getDetachedGroupsAfterPartDestroyed(runtime.topology, destroyedPartId)
    .filter((group) => !group.includes(cabinNodeId))
    .flat();
  const detachedIds = new Set(detachedNodeIds);
  if (detachedIds.size === 0) return { runtime, detachedPartIds: [], debris: [] };

  const detachedPartIds: string[] = [];
  const debris: DetachedDebrisEntity[] = [];
  const parts = runtime.parts.map((part) => {
    if (!detachedIds.has(part.id) || part.detached) return part;
    detachedPartIds.push(part.id);
    debris.push({
      partId: part.id,
      cells: part.gridCells,
      velocity: { x: 0, y: 0 },
      angularVelocity: part.kind === "panel" ? 0.6 : 0.35
    });
    return {
      ...part,
      hp: 0,
      state: "detached" as const,
      disabled: true,
      detached: true
    };
  });

  return {
    runtime: { ...runtime, parts },
    detachedPartIds,
    debris
  };
}
